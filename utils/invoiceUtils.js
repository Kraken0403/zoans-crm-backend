// utils/invoiceUtils.js

function generateInvoiceNumber(settings, sequence, now = new Date()) {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
  
    return String(settings.number_format || '{prefix}/{year}/{seq}')
      .replace('{prefix}', settings.prefix || 'INV')
      .replace('{year}', year)
      .replace('{month}', month)
      .replace('{seq}', String(sequence).padStart(4, '0'))
  }
  
  function round2(n) {
    const x = Number(n || 0)
    return Math.round(x * 100) / 100
  }
  
  /**
   * GST calculation per line
   * pricingMode: 'INCLUSIVE' | 'EXCLUSIVE'
   * isInterState: boolean
   */
  function calculateGSTLine({
    quantity,
    unitPrice,
    gstRate,
    pricingMode,
    isInterState,
  }) {
    const qty = Number(quantity || 0)
    const price = Number(unitPrice || 0)
    const rate = Number(gstRate || 0)
  
    const gross = qty * price // as entered
  
    let taxable = 0
    let taxAmount = 0
  
    if (pricingMode === 'INCLUSIVE') {
      // Gross includes GST
      taxable = gross / (1 + rate / 100)
      taxAmount = gross - taxable
    } else {
      // Gross is taxable, GST added on top
      taxable = gross
      taxAmount = taxable * (rate / 100)
    }
  
    let cgst = 0
    let sgst = 0
    let igst = 0
  
    if (rate > 0) {
      if (isInterState) {
        igst = taxAmount
      } else {
        cgst = taxAmount / 2
        sgst = taxAmount / 2
      }
    }
  
    const lineTotal = pricingMode === 'INCLUSIVE' ? gross : taxable + taxAmount
  
    return {
      taxable_amount: round2(taxable),
      cgst_amount: round2(cgst),
      sgst_amount: round2(sgst),
      igst_amount: round2(igst),
      line_total: round2(lineTotal),
    }
  }
  
  /**
   * Sum totals from items array (items already contain per-line computed fields)
   */
  function computeInvoiceTotals(items = []) {
    const totals = {
      subtotal: 0, // taxable subtotal (sum taxable_amount)
      cgst_total: 0,
      sgst_total: 0,
      igst_total: 0,
      grand_total: 0, // sum line_total
    }
  
    for (const it of items) {
      totals.subtotal += Number(it.taxable_amount || 0)
      totals.cgst_total += Number(it.cgst_amount || 0)
      totals.sgst_total += Number(it.sgst_amount || 0)
      totals.igst_total += Number(it.igst_amount || 0)
      totals.grand_total += Number(it.line_total || 0)
    }
  
    // round once at end
    Object.keys(totals).forEach(k => (totals[k] = round2(totals[k])))
    return totals
  }
  
  module.exports = {
    generateInvoiceNumber,
    calculateGSTLine,
    computeInvoiceTotals,
    round2,
  }
  