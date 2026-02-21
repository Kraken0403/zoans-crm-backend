const { generatePdf, generateHtml } = require('../services/invoicePdfService')

/* ---------------------------------------------------------
   DOWNLOAD INVOICE PDF
   GET /api/invoices/:id/pdf
--------------------------------------------------------- */
const downloadInvoicePdf = async (req, res) => {
  const { id } = req.params

  try {
    const pdfBuffer = await generatePdf(id)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${id}.pdf`
    )

    return res.send(pdfBuffer)
  } catch (err) {
    console.error('downloadInvoicePdf error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/* ---------------------------------------------------------
   PREVIEW INVOICE HTML (Debug Mode)
   GET /api/invoices/:id/preview
--------------------------------------------------------- */
const previewInvoiceHtml = async (req, res) => {
  const { id } = req.params

  try {
    const html = await generateHtml(id)
    res.setHeader('Content-Type', 'text/html')
    return res.send(html)
  } catch (err) {
    console.error('previewInvoiceHtml error:', err)
    return res.status(500).json({ error: err.message })
  }
}

module.exports = {
  downloadInvoicePdf,
  previewInvoiceHtml,
}
