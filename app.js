const configs = require('./config.json');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(configs.db_database_path);
const cryptoRandomString = require('crypto-random-string');

const routerInfo = require('./routes/index')(db);
const indexRouter = routerInfo.router;

const app = express();


app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(session({
    secret: configs.session_secret,
    // store: sessionStore,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true, sameSite: 'lax' },
}));

app.use(function (req, res, next) {
    if (!('csrf_token' in req.session) || req.session.csrf_token === null) {
        req.session.csrf_token = cryptoRandomString(32);
    }
    res.setHeader('CSRF-Token', req.session.csrf_token);
    next();
});

app.use(function (req, res, next) {
    req.db = db;
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(function (req, res, next) {
    // console.log('Headers:', req.headers);
    if (/^(GET|HEAD|OPTIONS)$/.test(req.method)) {
        return next();
    }
    if (!('CSRF-Token' in req.headers) || req.headers.csrf-token !== req.session.csrf_token) {
        console.warn('@@@ CSRF Token Invalid/Missing @@@');
        // return res.sendStatus(400);
    }
    next();
});

app.use('/', indexRouter);


app['shutdown'] = function (callback) {
    // sessionStore.close(() => {
    // console.log('Session Store Closed');
    routerInfo.quitter();
    db.close((err) => {
        console.log('Database Closed');
        callback();
    });
    // });
};

module.exports = app;
