// routes/uploadRoutes.js
const express = require('express')
const multer = require('multer')
const path = require('path')

const router = express.Router()
const authenticateJWT = require('../middleware/authMiddleware');

router.use(authenticateJWT);

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`)
  }
})

const upload = multer({ storage })

router.post('/upload/logo', upload.single('file'), (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
  res.json({ url })
})

module.exports = router
