const fs = require('fs')
const path = require('path')
const Handlebars = require('handlebars')

require('./handlebarsHelpers')

exports.loadTemplate = (data) => {
  // ✅ TEMPLATE IS INDEPENDENT OF MODE
  const templateName = data.template || 'general'

  const templatePath = path.join(
    __dirname,
    `../templates/quotations/${templateName}.html`
  )

  console.log('📄 USING TEMPLATE:', templatePath)

  const cssPath = path.join(
    __dirname,
    '../templates/quotations/base.css'
  )

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Quotation template not found: ${templateName}.html`)
  }

  const templateSource = fs.readFileSync(templatePath, 'utf8')
  const baseCss = fs.readFileSync(cssPath, 'utf8')

  const template = Handlebars.compile(templateSource)

  return template({
    ...data,
    baseCss,
  })
}
