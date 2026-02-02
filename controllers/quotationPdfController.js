const {
  generatePdf,
  generateHtml,
} = require('../services/quotationPdfService')

exports.exportPdf = async (req, res) => {
  try {
    const quotationId = req.params.id

    const pdfBuffer = await generatePdf(quotationId)

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('PDF generation returned empty buffer')
    }

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `inline; filename=quotation-${quotationId}.pdf`,
    })

    res.end(pdfBuffer)
  } catch (error) {
    console.error('PDF export error:', error)

    if (!res.headersSent) {
      res.status(500).send(error.message)
    }
  }
}

exports.previewHtml = async (req, res) => {
  try {
    const html = await generateHtml(req.params.id)
    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  } catch (error) {
    console.error('PDF preview error:', error)
    res.status(500).send(error.message)
  }
}
