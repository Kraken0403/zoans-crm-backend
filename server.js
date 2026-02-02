const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const authRoutes = require('./routes/authRoutes');
const leadRoutes = require('./routes/leadRoutes');
const meetingRoutes = require('./routes/meetingRoutes');
const customFieldRoutes = require('./routes/customFieldRoutes');
const leadFieldRoutes = require('./routes/leadFieldRoutes')
const userRoutes = require('./routes/userRoutes')
const emailRoutes = require('./routes/emailRoutes')
const workOrderRoutes = require('./routes/workOrderRoute');
// const workOrderItemsRoutes = require('./routes/workOrderItemsRoutes');
const productRoutes = require('./routes/productRoutes');
const quotationRoutes = require('./routes/quotationRoutes');
const contactsRoutes = require('./routes/contactsRoutes');
const companyRoutes = require('./routes/companyRoutes');
const quotationSettingsRoutes = require('./routes/quotationSettingsRoutes');
const settingsRoutes = require('./routes/settingsRoutes')
const activityRoutes = require('./routes/activityRoutes')
const notesRoutes = require('./routes/notesRoutes')
const filesRoutes = require('./routes/filesRoutes')
const uploadRoutes = require('./routes/upload.routes');
const cookieParser = require('cookie-parser');



const path = require("path");

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
  }));
app.use(bodyParser.json({limit: '10mb'}));
app.use(cookieParser());

// Routes
app.use('/auth', authRoutes); 
app.use('/api', leadRoutes); // For lead management routes
app.use('/api', customFieldRoutes)
app.use('/api', leadFieldRoutes);
app.use('/api/meetings', meetingRoutes); // For Meeting Routes
app.use('/api', userRoutes)
app.use('/api', emailRoutes)
app.use('/api', workOrderRoutes); // For work
// app.use('/api', workOrderItemsRoutes); 
app.use('/api', productRoutes); // For product routes
app.use('/api', quotationRoutes); // For product routes
// Default route for health check
app.use('/api', contactsRoutes);
app.use('/api', companyRoutes);
app.use('/api', quotationSettingsRoutes);
app.use('/api', settingsRoutes);
app.use('/api', settingsRoutes);

app.use('/api', activityRoutes);
app.use('/api', notesRoutes);
app.use('/api', filesRoutes);
app.use('/api', uploadRoutes);



app.get('/', (req, res) => {
    res.json({ message: 'API is running' });
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong' });
});

// Server listener
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
