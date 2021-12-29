const configs = require('../config.json');
const express = require('express');
const https = require('https');
const cron = require('node-cron');
const { exec } = require("child_process");
const tmi = require('tmi.js');

const cryptoRandomString = require('crypto-random-string');

const router = express.Router();

/* GET home page. */
// router.get('/', function (req, res, next) {
//     res.render('index', { title: 'Express' });
// });

router.get('/twitchlogin', function (req, res, next) {
    // let scope = 'user:read:subscriptions%20channel:read:redemptions';
    let scope = 'user:read:subscriptions';
    let csrf_token = cryptoRandomString(32);
    req.session.csrf_twitch = csrf_token;
    let force_verify = 'reauth' in req.query ? true : false;
    res.redirect(307, `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${configs.client_id}&redirect_uri=${configs.redirect_uri}&scope=${scope}&state=${csrf_token}&force_verify=${force_verify}`);
});

router.get('/twitchauth', function (req, res, next) {
    if (!('csrf_twitch' in req.session)) {
        return res.sendStatus(500);
    }
    if (!('state' in req.query) || !('code' in req.query) || !('scope' in req.query)) {
        return res.sendStatus(400);
    }
    if (req.query.state !== req.session.csrf_twitch) {
        res.sendStatus(400);
    }
    // let data = {
    //     'body': req.body,
    //     'query': req.query
    // };
    // console.log(data);
    checkauth(req, res);
});

function checkauth(req, res) {
    const apiReq = https.request(`https://id.twitch.tv/oauth2/token?client_id=${configs.client_id}&client_secret=${configs.client_secret}&code=${req.query.code}&grant_type=authorization_code&redirect_uri=${configs.redirect_uri}`, {
        method: 'POST'
    },
        function (resb) {
            // console.log('statusCode:', resb.statusCode);
            let data = '';
            resb.on('data', function (stream) {
                data += stream;
            });
            resb.on('end', async function () {
                data = JSON.parse(data);
                // console.log(data);

                let userData = await queryTwitchAPI('/users', [], data.access_token);
                if ('error' in userData) {
                    res.sendStatus(500);
                    console.error(userData);
                    return;
                } else {
                    userData = userData.data[0];
                }

                let sql = `INSERT INTO User (token_access, token_refresh, token_scope, token_issued, token_expiry, twitch_id) VALUES (?, ?, ?, ?, ?, ?);`;
                let now = Date.now();
                req.db.get(sql, [data.access_token, data.refresh_token, JSON.stringify(data.scope), now, now + data.expires_in * 1000, userData.id], async (err, row) => {
                    if (err) {
                        if (err.code === 'SQLITE_CONSTRAINT') {
                            //Found a user, but they already exist
                            //Update SQL User with new tokens!
                            let sql = 'UPDATE User SET token_access = ?, token_refresh = ?, token_scope = ?, token_issued = ?, token_expiry = ? WHERE twitch_id = ?;'
                            req.db.get(sql, [data.access_token, data.refresh_token, JSON.stringify(data.scope), now, now + data.expires_in * 1000, userData.id], async (err, row) => {
                                if (err) {
                                    res.sendStatus(500);
                                    console.error('ERROR:', err);
                                    return;
                                }
                                //Success Updated
                                await updateTwitchUserStatus(req.db, data.access_token);
                                req.session.twitch_id = userData.id;
                                // res.send(['USER ALREADY EXISTS - UPDATED', data, 'https://twitch.bryces.network/twitchlogin']);
                                res.redirect(307, '/');
                            });
                            return;
                        } else {
                            res.sendStatus(500);
                            console.error('ERROR:', err);
                            return;
                        }
                    }
                    await updateTwitchUserStatus(req.db, data.access_token);
                    // res.send([data, 'https://twitch.bryces.network/twitchlogin']);
                    req.session.twitch_id = userData.id;
                    res.redirect(307, '/');
                });
            });
            resb.on('error', function (err) {
                res.sendStatus(500);
            });
        }
    );
    apiReq.end();
}

function refreshToken(twitch_id) {
    return new Promise((resolve, reject) => {
        console.log('REFRESHING TOKEN FOR', twitch_id);
        let sql = 'SELECT token_refresh FROM User WHERE twitch_id=?';
        db.get(sql, [twitch_id], (err, row) => {
            if (err) {
                return reject(err);
            }
            let now = Date.now();
            const apiReq = https.request(`https://id.twitch.tv/oauth2/token?client_id=${configs.client_id}&client_secret=${configs.client_secret}&refresh_token=${row.token_refresh}&grant_type=refresh_token`, {
                method: 'POST'
            }, (res) => {
                let data = '';
                res.on('data', function (stream) {
                    data += stream;
                });
                res.on('end', async function () {
                    // console.log(data);
                    data = JSON.parse(data);
                    if ('error' in data) {
                        return reject(data);
                    }
                    let sql = 'UPDATE User SET token_access=?, token_refresh=?, token_scope=?, token_issued=?, token_expiry=? WHERE twitch_id=?;';
                    db.run(sql, [data.access_token, data.refresh_token, JSON.stringify(data.scope), now, now + data.expires_in * 1000, twitch_id]);
                    resolve(data);
                });
            });
            apiReq.end();
        });
    });
}

// router.get('/twitchapi', async function (req, res, next) {
//     if (!('token' in req.query)) {
//         res.sendStatus(400);
//         return;
//     }
//     // let broadcasterData = (await queryAPI('/users', [['login', 'angelnaomi']], req.query.token)).data[0];
//     let userData = (await queryTwitchAPI('/users', [], req.query.token)).data[0];
//     // console.log(broadcasterData);
//     // console.log(userData);

//     let endpoint1 = '/subscriptions/user';
//     let query1 = [['broadcaster_id', '645667972'], ['user_id', userData.id]];
//     let ap1 = await queryTwitchAPI(endpoint1, query1, req.query.token);

//     // let endpoint2 = '/channel_points/custom_rewards/redemptions';
//     // let query2 = [['broadcaster_id', configs.broadcaster_info.id], ['reward_id', 'a2030709-59ac-40be-b6f5-4bd5b1a64454'], ['status', 'CANCELED']];
//     // let ap2 = await queryAPI(endpoint2, query2, req.query.token);

//     // res.status(ap.status);
//     res.json([userData, ap1]);
// });
router.get('/twitchrefresh', async function (req, res, next) {
    res.json(await refreshToken(46119918));
});

function asyncDBGet(query, data) {
    return new Promise(async (resolve, reject) => {
        db.get(query, data, (err, row) => {
            if (err) {
                return reject(data);
            }
            resolve(row);
        });
    });
}

function queryTwitchAPI(endpoint, query, access_token, token_expiry, refreshed_try) {
    return new Promise(async (resolve, reject) => {
        if (access_token === null) {
            return reject({'error':'null_access_token'});
        }
        if (token_expiry !== undefined && token_expiry !== null && token_expiry <= Date.now()) {
            let twitch_id = (await asyncDBGet('SELECT twitch_id FROM User WHERE token_access=?', [access_token])).twitch_id;
            access_token = (await refreshToken(twitch_id)).access_token;
        }
        let q = '';
        query.forEach(element => {
            // console.log('element', element);
            q += '&' + element[0] + '=' + element[1];
        });
        q = q.replace('&', '?');
        console.log('Request:', `https://api.twitch.tv/helix${endpoint}${q}`);
        const apiReq = https.request(`https://api.twitch.tv/helix${endpoint}${q}`, (res) => {
            let data = '';
            res.on('data', function (stream) {
                data += stream;
            });
            res.on('end', async function () {
                data = JSON.parse(data);
                // console.log(data);
                if ('error' in data) {
                    if ('status' in data && data.status === 401 && refreshed_try === undefined) {
                        let twitch_id = (await asyncDBGet('SELECT twitch_id FROM User WHERE token_access=?', [access_token])).twitch_id;
                        access_token = (await refreshToken(twitch_id)).access_token;
                        queryTwitchAPI(endpoint, query, access_token, null, true);
                    } else if ('status' in data && data.status === 404) {
                        return resolve(data);
                    } else {
                        return reject(data);
                    }
                } else {
                    resolve(data);
                }
            });
        });
        apiReq.setHeader('Authorization', `Bearer ${access_token}`);
        apiReq.setHeader('Client-Id', `${configs.client_id}`);
        apiReq.end();
    });
}

function nameToUUID(username) {
    return new Promise((resolve, reject) => {
        console.log('Request', `https://api.mojang.com/users/profiles/minecraft/${username}`);
        const apiReq = https.request(`https://api.mojang.com/users/profiles/minecraft/${username}`, (res) => {
            let data = '';
            res.on('data', function (stream) {
                data += stream;
            });
            res.on('end', function () {
                if (res.statusCode === 204) {
                    resolve({});
                    return;
                }
                data = JSON.parse(data);
                if ('error' in data) {
                    reject(data);
                } else {
                    resolve(data);
                }
            });
        });
        apiReq.end();
    });
}

function getSkinFromUUID(uuid) {
    return new Promise((resolve, reject) => {
        console.log('Request', `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
        const apiReq = https.request(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, (res) => {
            let data = '';
            res.on('data', function (stream) {
                data += stream;
            });
            res.on('end', function () {
                // if (res.statusCode === 204) {
                //     resolve({});
                //     return;
                // }
                data = JSON.parse(data);
                if ('error' in data) {
                    reject(data);
                } else {
                    let link = JSON.parse(Buffer.from(data.properties[0].value, 'base64').toString()).textures.SKIN.url;
                    link = link.replace(/^http:\/\//i, 'https://');
                    resolve(link);
                }
            });
        });
        apiReq.end();
    });
}

/**
 * Call to update the user info (including sub status) of a Twitch user identified by their access token
 * @param {object} db The SQLite3 database object
 * @param {string} access_token The Twitch OAuth access token
 * @returns Promise
 */
function updateTwitchUserStatus(db, access_token) {
    return new Promise(async (resolve, reject) => {
        // console.log('A');
        try {
            let userData = await queryTwitchAPI('/users', [], access_token);
            if ('error' in userData) {
                console.log(userData);
                reject(userData);
                return;
            } else {
                {
                    userData = userData.data[0];
                }
            }
            let subData = await queryTwitchAPI('/subscriptions/user', [['broadcaster_id', configs.broadcaster_info.id], ['user_id', userData.id]], access_token);
            // console.log(subData);
            if ('error' in subData) {
                if (subData.error !== 'Not Found') {
                    reject(subData);
                    return;
                } else {
                    subData.is_sub = false;
                    subData.is_gift = false;
                    subData.tier = "0000";
                }
            } else {
                subData = subData.data[0];
                subData.is_sub = true;
            }
    
            let sql = 'UPDATE User SET twitch_login = ?, twitch_name = ?, twitch_is_gift = ?, twitch_is_sub = ?, twitch_sub_tier = ? WHERE twitch_id = ?;';
            db.get(sql, [userData.login, userData.display_name, subData.is_gift, subData.is_sub, subData.tier, userData.id], (err, row) => {
                if (err) {
                    console.error(err);
                    reject(err);
                    return;
                }
                resolve(row);
            });
        } catch (error) {
            console.log('Error updating twitch user status');
            reject({'error':'failure'});
        }
    });
}

// router.get('/session_info', function (req, res, next) {
    // if (req.session.is_admin === true) {
        // res.json(req.session);
        // return;
    // }
    // res.sendStatus(401);
// });

router.get('/logout', function (req, res, next) {
    req.session.twitch_id = null;
    res.redirect(307, '/');
});

//User must be logged in past here!
router.use(function (req, res, next) {
    if ('twitch_id' in req.session && req.session.twitch_id !== null) {
        next();
    } else {
        res.sendStatus(401);
    }
});

router.get('/userinfo', function (req, res, next) {
    let sql = 'SELECT minecraft_user, minecraft_uuid, twitch_id, twitch_name, twitch_is_sub, twitch_sub_tier FROM User WHERE twitch_id = ?;';
    req.db.get(sql, req.session.twitch_id, async (err, row) => {
        if (err) {
            res.sendStatus(500);
            console.error(err);
            return;
        }
        // console.log(row);
        if (row.minecraft_uuid !== undefined) {
            row.minecraft_skin = await getSkinFromUUID(row.minecraft_uuid);
        }
        res.json(row);
    });
});

router.patch('/updatemcuser', async function (req, res, next) {
    if (!('user' in req.body) || !('time' in req.body)) {
        res.sendStatus(400);
    }
    let mcuserinfo = await nameToUUID(req.body.user);
    if (!('id' in mcuserinfo)) {
        return res.sendStatus(404);
    }
    // console.log(mcuserinfo);
    let sql = 'UPDATE User SET minecraft_user=?, minecraft_uuid=?, time=? WHERE twitch_id = ?;';
    req.db.get(sql, [mcuserinfo.name, mcuserinfo.id, req.body.time, req.session.twitch_id], (err, row) => {
        if (err) {
            res.sendStatus(500);
            console.error(err);
            return;
        }
        res.sendStatus(204);
    });
});

function updateAllUserStatus() {
    return new Promise((resolve, reject) => {
        console.log('Starting Twitch Sub Update...');
        let sql = 'SELECT * FROM User WHERE token_access IS NOT NULL;';
        let to_update = -1;
        db.all(sql, [], async (err, rows) => {
            if (err) {
                reject();
                return;
            }

            to_update = rows.length;

            function cb() {
                to_update--;
                if (to_update <= 0) {
                    resolve();
                    console.log('Updated ALL');
                    return;
                }
            }

            rows.forEach(async (row) => {
                try {
                    await updateTwitchUserStatus(db, row.token_access);
                } catch (error) {
                    db.run('UPDATE User SET twitch_is_sub=false WHERE twitch_id=?;', [row.twitch_id]);
                    console.warn('Cleared sub status due to failure');
                }
                 //clear sub status on failure :)
                console.log(`Updated ${row.twitch_name}`)
                cb();
            });
        });
    });
}

function updateMinecraftPerms() {
    console.log('Starting MineCraft Sub Update...');
    let sql = 'SELECT twitch_id, minecraft_user, minecraft_uuid, minecraft_uuid_cache, twitch_is_sub FROM User WHERE minecraft_uuid IS NOT NULL AND (twitch_is_sub=1 OR minecraft_uuid_cache IS NOT NULL);';
    db.each(sql, [], async (err, row) => {
        if (err) {
            console.error('Error fetching sub status from DB for update:', err);
            return err;
        }
        // console.log('SUB UPDATE:\n', row);
        // 3 Possibilities
        // User is new sub
        // User is no longer subbed
        // UUID does not match cached UUID
        if (row.twitch_is_sub && row.minecraft_uuid_cache === null) {
            console.log('NEW SUB', row.minecraft_user);
            // Add sub perms
            await runMinecraftCommand(`lp user ${row.minecraft_uuid} parent add sub`);
            // cache uuid
            db.run('UPDATE User SET minecraft_uuid_cache=? WHERE twitch_id=?', [row.minecraft_uuid, row.twitch_id]);
        } else if (!row.twitch_is_sub) {
            console.log('UN- SUB', row.minecraft_user);
            // Remove sub perms
            await runMinecraftCommand(`lp user ${row.minecraft_uuid_cache} parent remove sub`);
            // remove cached uuid
            db.run('UPDATE User SET minecraft_uuid_cache=NULL WHERE twitch_id=?', [row.twitch_id]);
        } else if (row.minecraft_uuid !== row.minecraft_uuid_cache) {
            console.log('CHG SUB', row.minecraft_user);
            // Remove sub perms
            await runMinecraftCommand(`lp user ${row.minecraft_uuid_cache} parent remove sub`);
            // Add sub perms
            await runMinecraftCommand(`lp user ${row.minecraft_uuid} parent add sub`);
            // cache new uuid
            db.run('UPDATE User SET minecraft_uuid_cache=? WHERE twitch_id=?', [row.minecraft_uuid, row.twitch_id]);
        } else if (row.minecraft_uuid === row.minecraft_uuid_cache) {
            console.log('xxx SUB', row.minecraft_user);
            //Nothing was changed, still subbed
        } else {
            // Catch All
            console.error('Error checking sub status for update:\n', row);
        }
    });
    // console.log('Updated ALL');
}

function checkUsersStreaming() {
    let sql = 'SELECT twitch_id, minecraft_user FROM User WHERE minecraft_user IS NOT NULL;';
    db.all(sql, [], async (err, rows) => {
       if (err) {
           console.error(err);
           return;
       }
       
       if (rows.length > 100) {
           console.error('More than 100 users to check if live');
           await runMinecraftCommand('mail send eletric99 Error checking live users');
           return;
       }
       
       let creds = await asyncDBGet('SELECT token_access, token_refresh, token_expiry FROM User WHERE twitch_id=?;', ['46119918']);
       
       let query = [];
       rows.forEach((row) => {
           query.push(['user_id', row.twitch_id]);
       });
       
       // runMinecraftCommand('msg eletric99 '+JSON.stringify(creds));
       
       res = await queryTwitchAPI('/streams', query, creds.token_access, creds.token_expiry);
       await asyncDBGet('UPDATE User SET live=false;', []);
       res.data.forEach(async (stream) => {
           await asyncDBGet('UPDATE User SET live=true WHERE twitch_id=?;', [stream.user_id]);
           // console.log("ISLIVE", stream);
       });
       db.each('SELECT twitch_id, live, minecraft_uuid FROM User WHERE live IS NOT live_cache', [], async (err, row) => {
           if (err) {
               console.error(err);
               return;
           }
           if (row.live) {
               //Save into cache, set live status
               db.run('UPDATE User SET live_cache=true WHERE twitch_id=?', [row.twitch_id]);
               runMinecraftCommand(`lp user ${row.minecraft_uuid} parent add live`);
           } else {
               //Save into cache, un-set live status
               db.run('UPDATE User SET live_cache=false WHERE twitch_id=?', [row.twitch_id]);
               runMinecraftCommand(`lp user ${row.minecraft_uuid} parent remove live`);
           }
       });
       // console.log(res);
    });
}

function runMinecraftCommand(command) {
    return new Promise((resolve, reject) => {
        exec(`screen -S angelNaomiSMPServer -p 0 -X stuff "${command}^M"`, (error, stdout, stderr) => {
            if (error) {
                return reject({ 'error': error, 'stdout': stdout, 'stderr': stderr });
            }
            resolve({ 'error': error, 'stdout': stdout, 'stderr': stderr });
        });
    });
}

async function doPeriodicUpdate() {
    await updateAllUserStatus();
    updateMinecraftPerms();
}

//           ┌────────────── second (optional)
//           │ ┌──────────── minute
//           │ │ ┌────────── hour
//           │ │ │ ┌──────── day of month
//           │ │ │ │ ┌────── month
//           │ │ │ │ │ ┌──── day of week
//           │ │ │ │ │ │
//           │ │ │ │ │ │
//           * * * * * *

// Update status of all users every hour
cron.schedule('0,30 * * * *', async () => {
    console.log('Running automatic SUB update task');
    doPeriodicUpdate();
});

cron.schedule('*/5 * * * *', () => {
    console.log('Running automatic LIVE update task');
    checkUsersStreaming();
});

///////////////////////////////////////////////////////////////////////
//Twitch chat integration
const twitchclient = new tmi.client({
    identity: {
        username: configs.oauth.username,
        password: configs.oauth.password
    },
    channels: configs.channels
});

twitchclient.on('message', function (target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot
    // console.log(`TWITCH BOT: * Message:`, target, '\n', context, '\n', msg, '\n', self);
    // console.log(`TWITCH BOT: * ${target} - ${context['display-name']}: ${msg}`)
    if ('custom-reward-id' in context) {
        console.log(`${context['display-name']} (${context['user-id']}) redeemed ${context['custom-reward-id']} with "${msg}"`);
        
        let sql = "INSERT INTO User (twitch_id, redeemed_whitelist) VALUES (?, TRUE);";
        
        
    }
    // console.log('target',target,'\ncontext',context,'\nmsg',msg,'\nself',self);
});

twitchclient.on('connected', function (addr, port) {
    console.log(`TWITCH BOT: * Connected to ${addr}:${port}`);
});

twitchclient.connect();

///////////////////////////////////////////////////////////////////////

var db;
function init() {
    doPeriodicUpdate();
    checkUsersStreaming();
}


module.exports = function (database) {
    db = database;
    init();
    return router;
}
