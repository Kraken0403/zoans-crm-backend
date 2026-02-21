const puppeteer = require('puppeteer');
const db = require('../config/db');
const { loadWorkOrderTemplate } = require('./workOrderTemplateLoader');

/* =========================================================
   PUBLIC API
========================================================= */

exports.generatePdf = async (workOrderId) => {
  const data = await loadWorkOrderData(workOrderId);
  const html = loadWorkOrderTemplate(data);

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

    // Wait for images to load
    await page.evaluate(async () => {
      const images = Array.from(document.images);
      await Promise.all(
        images
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((res) => {
                img.onload = img.onerror = res;
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
    if (browser) {
      await browser.close();
    }
  }
};

exports.generateHtml = async (workOrderId) => {
  const data = await loadWorkOrderData(workOrderId);
  return loadWorkOrderTemplate(data);
};


/* =========================================================
   INTERNAL LOGIC
========================================================= */

async function loadWorkOrderData(workOrderId) {

  /* ---------- FORMATTERS ---------- */
  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };
  
  const formatTime = (time) => {
    if (!time) return '';
    return new Date(`1970-01-01T${time}`).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  /* ---------- LOAD WORK ORDER ---------- */

  const workOrder = await getWorkOrder(workOrderId);
  if (!workOrder) {
    throw new Error('Work Order not found');
  }

  /* ---------- LOAD SETTINGS ---------- */

  const settingsRaw = await getQuotationSettings();

  const settings = {
    ...settingsRaw,
    logo_url: resolveAssetUrl(settingsRaw?.logo_url),
  };

  /* ---------- FORMAT DATES ---------- */

  workOrder.issue_date_formatted = formatDate(workOrder.issue_date);
  workOrder.event_date_formatted = formatDate(workOrder.event_date);
  workOrder.event_time_formatted = formatTime(workOrder.event_time);

  /* ---------- CALCULATE GRAND TOTAL ---------- */

  const grandTotal = (workOrder.items || []).reduce(
    (sum, i) => sum + Number(i.line_total || 0),
    0
  );

  workOrder.grand_total = grandTotal;

  /* ---------- RETURN TEMPLATE DATA ---------- */
  return {
    workOrder,
    settings,
    today: formatDate(new Date()),
    isCatering: workOrder.quotation_mode === 'CATERING',
  };
}


/* =========================================================
   DATA LOADERS
========================================================= */

function resolveAssetUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;

  const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5000';
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function getWorkOrder(id) {
  const [rows] = await db.query(
    `
    SELECT 
      wo.*,
      q.quotation_number,
      q.quotation_mode,
      q.event_name,
      q.event_date,
      q.event_time,
      q.event_location,
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
    [id]
  );

  if (!rows.length) return null;

  const wo = rows[0];

  const [items] = await db.query(
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
    [id]
  );

  wo.items = items || [];

  return wo;
}


async function getQuotationSettings() {
  const [rows] = await db.query(
    `SELECT * FROM quotation_settings LIMIT 1`
  );

  return rows[0] || {};
}