// pdf/invoiceTemplateLoader.js

const fs = require('fs')
const path = require('path')
const Handlebars = require('handlebars')

/* ---------------------------------------------------------
   Load Base CSS
--------------------------------------------------------- */

function loadBaseCss() {
  const cssPath = path.join(
    __dirname,
    '..',
    'templates',
    'invoices',
    'base.css'
  )

  if (!fs.existsSync(cssPath)) {
    return ''
  }

  return fs.readFileSync(cssPath, 'utf8')
}

/* ---------------------------------------------------------
   Load Invoice HTML Template
--------------------------------------------------------- */

function loadHtmlTemplate() {
  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    'invoices',
    'invoice.html'
  )

  if (!fs.existsSync(templatePath)) {
    throw new Error('Invoice template file not found')
  }

  return fs.readFileSync(templatePath, 'utf8')
}

/* ---------------------------------------------------------
   Register Handlebars Helpers (ONLY ONCE)
--------------------------------------------------------- */

let helpersRegistered = false

function registerHelpers() {
  if (helpersRegistered) return

  Handlebars.registerHelper('currency', function (value) {
    const n = Number(value || 0)
    return `₹ ${n.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  })

  Handlebars.registerHelper('inc', function (value) {
    return Number(value) + 1
  })

  Handlebars.registerHelper('formatDate', function (date) {
    if (!date) return ''
    try {
      return new Date(date).toLocaleDateString('en-IN')
    } catch {
      return date
    }
  })

  helpersRegistered = true
}

/* ---------------------------------------------------------
   PUBLIC: loadInvoiceTemplate(data)
--------------------------------------------------------- */

function loadInvoiceTemplate(data) {
  registerHelpers()

  const baseCss = loadBaseCss()
  const htmlTemplate = loadHtmlTemplate()

  const template = Handlebars.compile(htmlTemplate)

  return template({
    ...data,
    baseCss,
  })
}

module.exports = {
  loadInvoiceTemplate,
}
