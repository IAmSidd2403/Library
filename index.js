import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";
import axios from "axios";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const saltRound = 10;
const OPEN_LIBRARY_API_URL = process.env.OPEN_LIBRARY_API_URL;

// Database setup 
const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});
db.connect();


app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect("/login");
    }
};

// Public routes for login and registration
app.get("/register", (req, res) => res.render("register.ejs"));
app.get("/login", (req, res) => res.render("login.ejs"));

const isPasswordValid = (password) => {
    const regex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*\W).{8,}$/;
    return regex.test(password);
}

app.post("/register", async (req, res) => {
    const { username, password } = req.body;

    if (!isPasswordValid(password)) {
        return res.status(400).send("Password does not meet the strength requirements.");
    }
    try {
        const checkResult = await db.query("SELECT * FROM users WHERE username = $1", [username]);
        if (checkResult.rows.length > 0) {
            return res.status(409).send("Username already exist. Please try to login.");
        }
        const hashedPassword = await bcrypt.hash(password, saltRound);
        await db.query("INSERT INTO users(username, password) VALUES ($1, $2 )", [username, hashedPassword]);
        res.redirect("/login");
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).send("Registration failed.");
    }
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.user = { id: user.id, username: user.username };
                res.redirect("/");
            } else {
                res.status(401).send("Incorrect username or password.");
            }
        } else {
            res.status(401).send("Incorrect username or password.");
        }
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).send("Login failed.");
    }
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
});


app.use(isAuthenticated);


// READ all books for the logged-in user 
app.get("/", async (req, res) => {
    let orderBy = "created_at DESC";

    // Check for sorting query parameters
    if (req.query.sort === "rating") {
        orderBy = "rating DESC";
    } else if (req.query.sort === "recency") {
        orderBy = "read_date DESC";
    }

    try {
        
        const result = await db.query(`SELECT * FROM books WHERE user_id = $1 ORDER BY ${orderBy}`, [req.session.user.id]);
        res.render("index.ejs", { books: result.rows });
    } catch (err) {
        console.error("Error fetching books:", err);
        res.status(500).send("Internal Server Error");
    }
});

// CREATE a New Book 
app.post("/add", async (req, res) => {
    const { isbn } = req.body;
    
    const userId = req.session.user.id;
    try {
        const url = `${OPEN_LIBRARY_API_URL}?bibkeys=ISBN:${isbn}&jscmd=data&format=json`;
        const response = await axios.get(url);
        const bookData = response.data[`ISBN:${isbn}`];

        const title = bookData.title;
        
        const authors = bookData.authors.map(author => author.name).join(", ");
        
        
        await db.query(
            "INSERT INTO books (title, authors, isbn, user_id) VALUES ($1, $2, $3, $4)",
            [title, authors, isbn, userId]
        );
        res.redirect("/");
    } catch (err) {
        console.error("Error adding book:", err);
        res.status(500).send("Internal Server Error");
    }
});

// READ one Book for editing 
app.get("/edit/:id", async (req, res) => {
    const id = req.params.id;
    try {
        
        const result = await db.query("SELECT * FROM books WHERE id = $1 AND user_id = $2", [id, req.session.user.id]);
        if (result.rows.length > 0) {
            res.render("edit.ejs", { book: result.rows[0] });
        } else {
            res.status(404).send("Book not found or you don't have permission to edit it.");
        }
    } catch (err) {
        console.error("Error fetching book for edit:", err);
        res.status(500).send("Internal Server Error");
    }
});

// UPDATE a Book 
app.post("/edit/:id", async (req, res) => {
    const id = req.params.id;
    const { title, authors, isbn, cover_id, rating, review, notes, read_date } = req.body;
    try {
        
        await db.query(
            "UPDATE books SET title = $1, authors = $2, isbn = $3, cover_id = $4, rating = $5, review = $6, notes = $7, read_date = $8, updated_at = NOW() WHERE id = $9 AND user_id = $10",
            [title, authors, isbn, cover_id, rating, review, notes, read_date, id, req.session.user.id]
        );
        res.redirect("/");
    } catch (err) {
        console.error("Error updating book:", err);
        res.status(500).send("Internal Server Error");
    }
});

// DELETE a Book 
app.post("/delete/:id", async (req, res) => {
    const id = req.params.id;
    try {
        
        await db.query("DELETE FROM books WHERE id = $1 AND user_id = $2", [id, req.session.user.id]);
        res.redirect("/");
    } catch (err) {
        console.error("Error deleting book:", err);
        res.status(500).send("Internal Server Error");
    }
});

// READ one Book for details
app.get("/books/:id", async (req, res) => {
    const id = req.params.id;
    try {
        
        const result = await db.query("SELECT * FROM books WHERE id = $1 AND user_id = $2", [id, req.session.user.id]);
        if (result.rows.length > 0) {
            res.render("book-details.ejs", { book: result.rows[0] });
        } else {
            res.status(404).send("Book not found or you don't have permission to view it.");
        }
    } catch (err) {
        console.error("Error fetching book details:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
})