const nodemailer = require("nodemailer");
const path = require("path");

// Email sending function
const sendEmail = async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    phone_number,
    company_name,
    lead_status,
    priority,
    follow_up_date,
    assigned_salesperson,
    custom_fields,
    amount,
    notes,
    salesperson_email, // New field for recipient email
  } = req.body;

  try {
    // Dynamically import nodemailer-express-handlebars
    const { default: nodemailerExpressHandlebars } = await import("nodemailer-express-handlebars");

    const transporter = nodemailer.createTransport({
    //   host: 'logionsolutions.com',
    //   port: 465,
    //   secure: true,
    service: 'gmail',
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      debug: true, // Enable debug mode
      logger: true, // Log connection details
    });

    const hbsOptions = {
      viewEngine: {
        extName: ".hbs",
        partialsDir: path.resolve("./templates/"),
        defaultLayout: false,
      },
      viewPath: path.resolve("./templates/"),
      extName: ".handlebars",
    };

    transporter.use("compile", nodemailerExpressHandlebars(hbsOptions));

    const context = {
      first_name,
      last_name,
      email,
      phone_number,
      company_name,
      lead_status,
      priority,
      follow_up_date: new Date(follow_up_date).toLocaleString(), // Format the date
      assigned_salesperson,
      custom_fields,
      amount,
      notes,
    };


    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: salesperson_email,
      subject: `New Lead Assigned: ${first_name} ${last_name}`,
      template: "userassignment",
      headers: {
        'X-Priority': '3', // Normal priority
        'X-Mailer': 'Nodemailer', // Specify the mailer
      },
      context: context
    });

    res.status(200).json({ success: true, message: "Email sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ success: false, message: "Failed to send email." });
  }
};

module.exports = { sendEmail };
