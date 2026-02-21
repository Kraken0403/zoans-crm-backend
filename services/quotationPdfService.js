const puppeteer = require('puppeteer');
const db = require('../config/db');
const { loadTemplate } = require('./templateLoader');

/* ---------------- PUBLIC API ---------------- */

exports.generatePdf = async (quotationId) => {
  const data = await loadQuotationData(quotationId);
  const html = loadTemplate(data);

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 0,
    });

    // 🔥 WAIT FOR IMAGES
    await page.evaluate(async () => {
      const images = Array.from(document.images);
      await Promise.all(
        images
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((resolve) => {
                img.onload = img.onerror = resolve;
              })
          )
      );
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '15mm',
        right: '15mm',
      },
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
};

exports.generateHtml = async (quotationId) => {
  const data = await loadQuotationData(quotationId);
  return loadTemplate(data);
};

/* ---------------- INTERNAL ---------------- */

async function loadQuotationData(quotationId) {
  const quotation = await getQuotation(quotationId);
  if (!quotation) throw new Error('Quotation not found');

  const settingsRaw = await getQuotationSettings();

  const settings = {
    ...settingsRaw,
    logo_url: resolveAssetUrl(settingsRaw?.logo_url),
  };

  const categories = await getAllCategories();
  const categoryMap = buildCategoryMap(categories);

  const categoryGroups = groupItemsByTopCategory(
    quotation.items || [],
    categoryMap,
    quotation
  );

  quotation.categoryGroups = categoryGroups;
  quotation.grand_total = categoryGroups.reduce(
    (sum, g) => sum + Number(g.grand_total || 0),
    0
  );

  return {
    mode: quotation.quotation_mode || 'GENERAL',
    quotation,
    settings,
    today: new Date().toLocaleDateString('en-IN'),
  };
}

/* ---------------- DATA LOADERS (Promise-native) ---------------- */

function resolveAssetUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;

  const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5000';
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function getQuotation(id) {
  const [rows] = await db.query(
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
    [id]
  );

  if (!rows.length) return null;

  const q = rows[0];

  // ✅ Normalize quotation + catering meta
  const quotation = {
    ...q,
    catering: {
      pax: Number(q.pax) || 0,
      event_name: q.event_name || '',
      event_date: q.event_date ? String(q.event_date).substring(0, 10) : '',
      event_time: q.event_time || '',
      event_location: q.event_location || '',
    },
    items: [],
  };

  const [items] = await db.query(
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
    [id]
  );

  quotation.items = items || [];

  return quotation;
}

async function getQuotationSettings() {
  const [rows] = await db.query(`SELECT * FROM quotation_settings LIMIT 1`);
  return rows[0] || {};
}

async function getAllCategories() {
  const [rows] = await db.query(`SELECT id, name, parent_id FROM categories`);
  return rows || [];
}

/* ---------------- CATEGORY HELPERS ---------------- */

function buildCategoryMap(categories) {
  const map = {};
  for (const c of categories) {
    map[c.id] = c;
  }
  return map;
}

function getTopParentCategory(categoryId, categoryMap) {
  let current = categoryMap[categoryId];
  const seen = new Set(); // 🔥 prevents infinite loop if data is corrupted

  while (current && current.parent_id) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    current = categoryMap[current.parent_id];
  }

  return current;
}

function groupItemsByTopCategory(items, categoryMap, quotation) {
  const groups = {};

  const isCatering = quotation?.quotation_mode === 'CATERING';
  const pax = isCatering ? Number(quotation?.pax || 0) : 0;

  for (const i of items) {
    // -----------------------------
    // QUANTITY LOGIC
    // -----------------------------
    const qty = isCatering ? pax : Number(i.quantity || 0);
    const rate = Number(i.selling_price || 0);

    // -----------------------------
    // TOTAL CALCULATION
    // -----------------------------
    const lineTotal = qty * rate;
    const discount = Number(i.discount || 0);
    const tax = Number(i.tax || 0);
    const finalTotal = lineTotal - discount + tax;

    // -----------------------------
    // ITEM SHAPE FOR PDF
    // -----------------------------
    const item = {
      title: i.product_name || 'Item',
      brand: i.brand || '',
      sku: i.variant_sku || '',
      qty,
      rate,
      rateLabel: isCatering
        ? 'per pax'
        : (
            i.selling_price_qty
              ? `${i.selling_price_qty} ${i.selling_price_unit || ''}`.trim()
              : (i.selling_price_unit || '')
          ),
      total: lineTotal,
      discount,
      tax,
      finalTotal,
    };

    // -----------------------------
    // CATEGORY RESOLUTION
    // -----------------------------
    let topCategory = null;
    if (i.category_id) {
      topCategory = getTopParentCategory(i.category_id, categoryMap);
    }

    const groupKey = topCategory?.id || 'uncategorized';
    const groupName = topCategory?.name || 'Uncategorized';

    if (!groups[groupKey]) {
      groups[groupKey] = {
        category_id: groupKey,
        category_name: groupName,
        items: [],
        sub_total: 0,
        discount_total: 0,
        tax_total: 0,
        grand_total: 0,
      };
    }

    // -----------------------------
    // AGGREGATION
    // -----------------------------
    groups[groupKey].items.push(item);
    groups[groupKey].sub_total += lineTotal;
    groups[groupKey].discount_total += discount;
    groups[groupKey].tax_total += tax;
    groups[groupKey].grand_total += finalTotal;
  }

  return Object.values(groups);
}
