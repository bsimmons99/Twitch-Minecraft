var app = new Vue({
    el: '#app',
    data: {
        message: 'Hello Vue!',
        userinfo: null,
        update_error: null,
        update_pending: false,
        logging_in: false
    },
    methods: {
        init: function() {
            this.ajax('GET', '/userinfo', null, function (data) {
                data = JSON.parse(data);
                app.userinfo = data;
            });
        },
        updatemcuser: function() {
            if (this.userinfo.minecraft_user.length < 1) {
                return;
            }
            app.update_pending = true;
            app.update_error = null;
            this.ajax('PATCH', '/updatemcuser', {'user': this.userinfo.minecraft_user}, () => {
                app.update_error = false;
                app.update_pending = false;
                this.init();
            }, (status) => {
                app.update_pending = false;
                // console.warn('err', status);
                if (status === 404) {
                    app.update_error = true;
                } else if (status === 401) {
                    location.reload();
                }
            });
        },
        ajax: function(method, path, data, callback, callbackerr) {
            // if (typeOf(data) == 'function') {
            //     callback = data;
            //     data = null;
            // }

            var xhttp = new XMLHttpRequest();
            xhttp.onreadystatechange = function() {
                if (this.readyState == 4) {
                    if (this.status == 200 || this.status == 204) {
                        callback(this.response);
                    } else {
                        if (callbackerr !== undefined) {
                            callbackerr(this.status);
                        }
                    }
                }
            };
            xhttp.open(method, path, true);
            xhttp.setRequestHeader('Content-Type', 'application/json');
            if (data !== null) {
                data.time = new Date().toString();
                xhttp.send(JSON.stringify(data));
            } else {
                xhttp.send();
            }
        }
    }
});

app.init();
document.getElementById('app').hidden = false;

document.getElementById("username_field").addEventListener("keydown", keypress);
function keypress(e) {
    if (e.key === "Enter") {
        app.updatemcuser();
    }
}
