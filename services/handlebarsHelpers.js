const Handlebars = require('handlebars')

Handlebars.registerHelper('inc', (v) => Number(v) + 1)

Handlebars.registerHelper('currency', (v) => {
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  return `₹ ${n.toFixed(2)}`
})
