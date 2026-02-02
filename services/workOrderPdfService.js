const puppeteer = require('puppeteer')
const db = require('../config/db')
const { loadWorkOrderTemplate } = require('./workOrderTemplateLoader')

/* ---------------- PUBLIC API ---------------- */

exports.generatePdf = async (workOrderId) => {
  const data = await loadWorkOrderData(workOrderId)
  const html = loadWorkOrderTemplate(data)

  const browser = await puppeteer.launch({
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

  // 🔥 wait for images
  await page.evaluate(async () => {
    const images = Array.from(document.images)
    await Promise.all(
      images
        .filter(img => !img.complete)
        .map(img => new Promise(res => {
          img.onload = img.onerror = res
        }))
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

  await browser.close()
  return Buffer.from(pdf)
}

exports.generateHtml = async (workOrderId) => {
  const data = await loadWorkOrderData(workOrderId)
  return loadWorkOrderTemplate(data)
}

/* ---------------- INTERNAL ---------------- */

async function loadWorkOrderData(workOrderId) {
  const workOrder = await getWorkOrder(workOrderId)
  if (!workOrder) throw new Error('Work Order not found')

  const settingsRaw = await getQuotationSettings()

  const settings = {
    ...settingsRaw,
    logo_url: resolveAssetUrl(settingsRaw.logo_url),
  }

  // totals
  const grandTotal = (workOrder.items || []).reduce(
    (sum, i) => sum + Number(i.line_total || 0),
    0
  )

  workOrder.grand_total = grandTotal

  return {
    workOrder,
    settings,
    today: new Date().toLocaleDateString('en-IN'),
  }
}

/* ---------------- DATA LOADERS ---------------- */

function resolveAssetUrl(url) {
  if (!url) return ''
  if (url.startsWith('http')) return url

  const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5000'
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

function getWorkOrder(id) {
  return new Promise((resolve, reject) => {
    db.query(
      `
      SELECT 
        wo.*,
        q.quotation_number,
        l.first_name,
        l.last_name,
        l.company_name,
        l.email,
        l.phone_number,
        l.gst_number
      FROM work_orders wo
      LEFT JOIN quotations q ON q.id = wo.quotation_id
      LEFT JOIN leads l ON l.id = q.lead_id
      WHERE wo.id = ?
      `,
      [id],
      (err, rows) => {
        if (err) return reject(err)
        if (!rows.length) return resolve(null)

        const wo = rows[0]

        db.query(
          `
          SELECT
            woi.*,
            p.name AS product_name,
            p.brand
          FROM work_order_items woi
          LEFT JOIN products p ON p.id = woi.product_id
          WHERE woi.work_order_id = ?
          ORDER BY woi.id ASC
          `,
          [id],
          (err, items) => {
            if (err) return reject(err)
            wo.items = items || []
            resolve(wo)
          }
        )
      }
    )
  })
}

function getQuotationSettings() {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT * FROM quotation_settings LIMIT 1`,
      [],
      (err, rows) => {
        if (err) return reject(err)
        resolve(rows[0] || {})
      }
    )
  })
}
