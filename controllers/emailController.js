const nodemailer = require("nodemailer");
const path = require("path");

/* =====================================================
   SEND LEAD ASSIGNMENT EMAIL
===================================================== */
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
    salesperson_email,
  } = req.body;

  if (!salesperson_email) {
    return res.status(400).json({
      success: false,
      message: "Recipient email is required",
    });
  }

  try {
    const { default: nodemailerExpressHandlebars } =
      await import("nodemailer-express-handlebars");

    const transporter = nodemailer.createTransport({
      service: "gmail", // Keep simple
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Handlebars config
    transporter.use(
      "compile",
      nodemailerExpressHandlebars({
        viewEngine: {
          extName: ".hbs",
          partialsDir: path.resolve("./templates/"),
          defaultLayout: false,
        },
        viewPath: path.resolve("./templates/"),
        extName: ".hbs",
      })
    );

    const formattedDate = follow_up_date
      ? new Date(follow_up_date).toLocaleString()
      : "N/A";

    const context = {
      first_name,
      last_name,
      email,
      phone_number,
      company_name,
      lead_status,
      priority,
      follow_up_date: formattedDate,
      assigned_salesperson,
      custom_fields: custom_fields || [],
      amount,
      notes,
    };

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: salesperson_email,
      subject: `New Lead Assigned: ${first_name || ""} ${last_name || ""}`,
      template: "userassignment",
      context,
    });

    return res.status(200).json({
      success: true,
      message: "Email sent successfully",
    });

  } catch (error) {
    console.error("EMAIL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send email",
    });
  }
};

module.exports = { sendEmail };
