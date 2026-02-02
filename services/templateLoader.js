const fs = require('fs')
const path = require('path')
const Handlebars = require('handlebars')

require('./handlebarsHelpers')

exports.loadTemplate = (data) => {
  const mode = (data.mode || 'GENERAL').toLowerCase()

  const templatePath = path.join(
    __dirname,
    `../templates/quotations/${mode}.html`
  )

  console.log('📄 USING TEMPLATE:', templatePath)

  const cssPath = path.join(__dirname, '../templates/quotations/base.css')

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Quotation template not found for mode: ${mode}`)
  }

  const templateSource = fs.readFileSync(templatePath, 'utf8')
  const baseCss = fs.readFileSync(cssPath, 'utf8')

  const template = Handlebars.compile(templateSource)

  return template({
    ...data,
    baseCss,
  })
}
