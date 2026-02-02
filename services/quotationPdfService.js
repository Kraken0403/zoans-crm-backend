const puppeteer = require('puppeteer')
const db = require('../config/db')
const { loadTemplate } = require('./templateLoader')

/* ---------------- PUBLIC API ---------------- */

exports.generatePdf = async (quotationId) => {
  const data = await loadQuotationData(quotationId)
  const html = loadTemplate(data)

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

  // 🔥 CRITICAL FIX — WAIT FOR IMAGES
  await page.evaluate(async () => {
    const images = Array.from(document.images)
    await Promise.all(
      images
        .filter(img => !img.complete)
        .map(
          img =>
            new Promise(resolve => {
              img.onload = img.onerror = resolve
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

  await browser.close()
  return Buffer.from(pdf)
}


exports.generateHtml = async (quotationId) => {
  const data = await loadQuotationData(quotationId)
  return loadTemplate(data)
}

/* ---------------- INTERNAL ---------------- */

async function loadQuotationData(quotationId) {
  const quotation = await getQuotation(quotationId)
  if (!quotation) throw new Error('Quotation not found')

  const settingsRaw = await getQuotationSettings()

  const settings = {
    ...settingsRaw,
    logo_url: resolveAssetUrl(settingsRaw.logo_url),
  }

  const categories = await getAllCategories()

  const categoryMap = buildCategoryMap(categories)

  const categoryGroups = groupItemsByTopCategory(
    quotation.items || [],
    categoryMap
  )

  quotation.categoryGroups = categoryGroups
  quotation.grand_total = categoryGroups.reduce(
    (sum, g) => sum + g.grand_total,
    0
  )

  return {
    mode: quotation.mode || 'GENERAL',
    quotation,
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


function getQuotation(id) {
  return new Promise((resolve, reject) => {
    db.query(
      `
      SELECT 
        q.*,
        l.first_name,
        l.last_name,
        l.company_name,
        l.email,
        l.phone_number,
        l.gst_number,
        l.contact_name
      FROM quotations q
      LEFT JOIN leads l ON l.id = q.lead_id
      WHERE q.id = ?
      `,
      [id],
      (err, rows) => {
        if (err) return reject(err)
        if (!rows.length) return resolve(null)

        const quotation = rows[0]

        db.query(
          `
          SELECT
            qi.*,
            p.brand,
            p.category_id,
            c.name AS category_name,
            c.parent_id AS category_parent_id
          FROM quotation_items qi
          LEFT JOIN products p ON p.id = qi.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE qi.quotation_id = ?
          ORDER BY qi.id ASC
          `,
          [id],
          (err, items) => {
            if (err) return reject(err)
            quotation.items = items
            resolve(quotation)
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

function getAllCategories() {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT id, name, parent_id FROM categories`,
      [],
      (err, rows) => {
        if (err) return reject(err)
        resolve(rows || [])
      }
    )
  })
}

/* ---------------- CATEGORY HELPERS ---------------- */

function buildCategoryMap(categories) {
  const map = {}
  categories.forEach(c => {
    map[c.id] = c
  })
  return map
}

function getTopParentCategory(categoryId, categoryMap) {
  let current = categoryMap[categoryId]
  while (current && current.parent_id) {
    current = categoryMap[current.parent_id]
  }
  return current
}

function groupItemsByTopCategory(items, categoryMap) {
  const groups = {}

  for (const i of items) {
    const qty = Number(i.quantity || 0)
    const rate = Number(i.selling_price || 0)
    const lineTotal = Number(i.line_total ?? qty * rate)
    const discount = Number(i.discount || 0)
    const tax = Number(i.tax || 0)
    const finalTotal = lineTotal - discount + tax

    const item = {
      title: i.product_name || 'Item',
      brand: i.brand || '',
      sku: i.variant_sku || '',
      qty,
      rate,
      rateLabel: i.selling_price_qty
        ? `${i.selling_price_qty} ${i.selling_price_unit || ''}`.trim()
        : i.selling_price_unit || '',
      total: lineTotal,
      discount,
      tax,
      finalTotal,
    }

    let topCategory = null

    if (i.category_id) {
      topCategory = getTopParentCategory(i.category_id, categoryMap)
    }

    const groupKey = topCategory?.id || 'uncategorized'
    const groupName = topCategory?.name || 'Uncategorized'

    if (!groups[groupKey]) {
      groups[groupKey] = {
        category_id: groupKey,
        category_name: groupName,
        items: [],
        sub_total: 0,
        discount_total: 0,
        tax_total: 0,
        grand_total: 0,
      }
    }

    groups[groupKey].items.push(item)
    groups[groupKey].sub_total += lineTotal
    groups[groupKey].discount_total += discount
    groups[groupKey].tax_total += tax
    groups[groupKey].grand_total += finalTotal
  }

  return Object.values(groups)
}
