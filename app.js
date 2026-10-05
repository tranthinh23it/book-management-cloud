require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { engine } = require("express-handlebars");

const { connectDatabases, getConnections } = require("./config/db");
const getBookModel = require("./models/Book");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Đọc và xử lý thông tin cá nhân hóa từ .env
const studentId = (process.env.STUDENT_ID || "").trim();
const studentName = process.env.STUDENT_NAME || "Chưa cấu hình";

if (!studentId) {
  throw new Error("Thiếu STUDENT_ID trong file .env");
}

// Lấy tất cả chữ số có trong MSSV để tính VAT (VD: "23IT263" -> "23263")
const numericId = studentId.replace(/\D/g, "");

const prefix = studentId.slice(-3); // 3 ký tự cuối MSSV ("263")
const vatRate = Number(numericId.slice(-1)) + 5; // Chữ số cuối ("3") + 5 = 8%

if (
  !process.env.SESSION_SECRET ||
  !process.env.READ_MONGODB_URI ||
  !process.env.WRITE_MONGODB_URI
) {
  throw new Error("Thiếu biến môi trường bắt buộc.");
}

// 2. Cấu hình Handlebars View Engine
app.engine(
  "handlebars",
  engine({
    defaultLayout: "main"
  })
);
app.set("view engine", "handlebars");
app.set("views", "./views");

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// 3. Cấu hình Session Store dùng MongoDB Atlas (Chuẩn connect-mongo v4+)
app.use(
  session({
    name: "book.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.WRITE_MONGODB_URI,
      collectionName: "sessions",
      ttl: 14 * 24 * 60 * 60
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  })
);

// Middleware truyền biến chung ra tất cả các Views (Footer)
app.use((req, res, next) => {
  res.locals.studentName = studentName;
  res.locals.studentId = studentId;
  res.locals.vatRate = vatRate;
  next();
});

// --- CÁC ROUTES DỰ ÁN ---

app.get("/", (req, res) => {
  res.redirect("/books");
});

// READ: Xem danh sách sách (dùng kết nối Read)
app.get("/books", async (req, res, next) => {
  try {
    const { readConnection } = getConnections();
    const Book = getBookModel(readConnection);

    const books = await Book.find({}).sort({ createdAt: -1 }).lean();

    res.render("books", {
      title: "Danh sách sách",
      books
    });
  } catch (error) {
    next(error);
  }
});

app.get("/books/new", (req, res) => {
  res.render("new-book", {
    title: "Thêm sách"
  });
});

// WRITE: Thêm sách mới (dùng kết nối Write)
app.post("/books", async (req, res, next) => {
  try {
    const { productCode, title, author } = req.body;
    const code = (productCode || "").trim();
    const bookTitle = (title || "").trim();
    const bookAuthor = (author || "").trim();
    const price = Number(req.body.price);

    if (!code.startsWith(prefix)) {
      return res.status(400).render("new-book", {
        title: "Thêm sách",
        error: `Mã sách phải bắt đầu bằng 3 số cuối MSSV (${prefix}).`
      });
    }

    if (!code || !bookTitle || !bookAuthor || !Number.isFinite(price) || price < 0) {
      return res.status(400).render("new-book", {
        title: "Thêm sách",
        error: "Vui lòng nhập thông tin hợp lệ."
      });
    }

    const { writeConnection } = getConnections();
    const Book = getBookModel(writeConnection);

    const priceAfterTax = Number((price * (1 + vatRate / 100)).toFixed(2));

    await Book.create({
      productCode: code,
      title: bookTitle,
      author: bookAuthor,
      price,
      vatRate,
      priceAfterTax
    });

    res.redirect("/books");
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).render("new-book", {
        title: "Thêm sách",
        error: "Mã sách đã tồn tại."
      });
    }
    next(error);
  }
});

// Middleware xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error(err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).send("Đã xảy ra lỗi máy chủ.");
});

// Khởi chạy server sau khi đã kết nối thành công 2 CSDL
async function start() {
  await connectDatabases();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Cannot start application:", error.message);
  process.exit(1);
});