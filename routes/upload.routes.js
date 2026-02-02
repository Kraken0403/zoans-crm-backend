const express = require('express')
const multer = require('multer')
const path = require('path')

const router = express.Router()
const authenticateJWT = require('../middleware/authMiddleware');

router.use(authenticateJWT);

/* ======================================================
   EXISTING LOGO UPLOAD (DO NOT TOUCH)
   Used for quotation templates
====================================================== */

const logoStorage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`)
  }
})

const uploadLogo = multer({ storage: logoStorage })

router.post('/upload/logo', uploadLogo.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
  res.json({ url })
})

/* ======================================================
   NEW PRODUCT IMAGE UPLOAD (ADDED)
====================================================== */

const productImageStorage = multer.diskStorage({
  destination: 'uploads/products',
  filename: (_, file, cb) => {
    cb(null, `product-${Date.now()}${path.extname(file.originalname)}`)
  }
})

const uploadProductImage = multer({
  storage: productImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files allowed'), false)
    }
    cb(null, true)
  }
})

router.post(
  '/upload/product-image',
  uploadProductImage.single('file'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const url = `${req.protocol}://${req.get('host')}/uploads/products/${req.file.filename}`
    res.json({ url })
  }
)

module.exports = router
