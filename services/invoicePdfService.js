// services/invoicePdfService.js

const puppeteer = require('puppeteer')
const db = require('../config/db')
const { loadInvoiceTemplate } = require('./invoiceTemplateLoader')

/* ---------------------------------------------------------
   PUBLIC API
--------------------------------------------------------- */

exports.generatePdf = async (invoiceId) => {
  const data = await loadInvoiceData(invoiceId)
  const html = loadInvoiceTemplate(data)

  let browser

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })

    const page = await browser.newPage()

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 0,
    })

    // wait for images
    await page.evaluate(async () => {
      const images = Array.from(document.images)
      await Promise.all(
        images
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((res) => {
                img.onload = img.onerror = res
              })
          )
      )
    })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '15mm',
        right: '15mm',
      },
    })

    return Buffer.from(pdf)
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

exports.generateHtml = async (invoiceId) => {
  const data = await loadInvoiceData(invoiceId)
  return loadInvoiceTemplate(data)
}

/* ---------------------------------------------------------
   INTERNAL
--------------------------------------------------------- */

async function loadInvoiceData(invoiceId) {
  const invoice = await getInvoice(invoiceId)
  if (!invoice) {
    throw new Error('Invoice not found')
  }

  const settingsRaw = await getCompanySettings()
  const invoiceSettings = await getInvoiceSettings()

  const company = {
    ...settingsRaw,
    company_logo: resolveAssetUrl(settingsRaw?.company_logo),
  }

  return {
    invoice,
    company,
    invoiceSettings,
    today: new Date().toLocaleDateString('en-IN'),
  }
}

/* ---------------------------------------------------------
   DATA LOADERS
--------------------------------------------------------- */

function resolveAssetUrl(url) {
  if (!url) return ''
  if (String(url).startsWith('http')) return url

  const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5000'
  return `${BASE_URL}${String(url).startsWith('/') ? '' : '/'}${url}`
}

async function getCompanySettings() {
  const [rows] = await db.query(`SELECT * FROM settings LIMIT 1`)
  return rows[0] || {}
}

async function getInvoiceSettings() {
  const [rows] = await db.query(`SELECT * FROM invoice_settings LIMIT 1`)
  return rows[0] || {}
}

async function getInvoice(id) {
  const [rows] = await db.query(
    `
    SELECT *
    FROM invoices
    WHERE id = ?
    `,
    [id]
  )

  if (!rows.length) return null

  const invoice = rows[0]

  // parse snapshots safely
  try {
    invoice.billing_snapshot =
      typeof invoice.billing_snapshot === 'string'
        ? JSON.parse(invoice.billing_snapshot)
        : invoice.billing_snapshot
  } catch {}

  try {
    invoice.shipping_snapshot =
      typeof invoice.shipping_snapshot === 'string'
        ? JSON.parse(invoice.shipping_snapshot)
        : invoice.shipping_snapshot
  } catch {}

  const [items] = await db.query(
    `
    SELECT *
    FROM invoice_items
    WHERE invoice_id = ?
    ORDER BY id ASC
    `,
    [id]
  )

  invoice.items = items || []

  return invoice
}
