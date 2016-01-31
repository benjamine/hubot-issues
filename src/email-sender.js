
var email  = require('emailjs');

function EmailSender() {
}

EmailSender.prototype.enableTestMode = function () {
  this.testMode = true;
};

EmailSender.prototype.configure = function (options) {
  if (this.testMode) {
    return;
  }
  this.server = email.server.connect(options);
};

EmailSender.prototype.autoconfigure = function () {
  if (this.testMode) {
    return;
  }

  // try to detect smtp configuration automatically
  var options;

  if (process.env.POSTMARK_SMTP_SERVER) {
    options = {
      user: process.env.POSTMARK_API_TOKEN,
      password: process.env.POSTMARK_API_TOKEN,
      host: process.env.POSTMARK_SMTP_SERVER,
      port: process.env.POSTMARK_SMTP_PORT || process.env.SMTP_PORT || 25,
      domain: process.env.POSTMARK_SMTP_DOMAIN || process.env.SMTP_DOMAIN,
      ssl: !/^(no|false|0)$/i.test(process.env.SMTP_SSL),
    };
  } else if (process.env.SMTP_SERVER) {
    options = {
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      host: process.env.SMTP_SERVER,
      port: process.env.SMTP_PORT || 25,
      domain: process.env.SMTP_DOMAIN,
      ssl: !/^(no|false|0)$/i.test(process.env.SMTP_SSL),
    };
  }

  if (!options) {
    return;
  }
  this.options = options;
  this.server = email.server.connect(options);
};

EmailSender.prototype.send = function(message, callback) {
  /*{
   text:    "i hope this works",
   from:    "you <username@your-email.com>",
   to:      "someone <someone@your-email.com>, another <another@your-email.com>",
   cc:      "else <else@your-email.com>",
   subject: "testing emailjs"
  }*/
  if (!this.server) {
    this.autoconfigure();
  }
  if (!message.from) {
    message.from = this.defaultFrom || process.env.POSTMARK_SMTP_FROM || process.env.SMTP_FROM ||
      ('no-reply@' + ((this.options && this.options.domain) || 'localhost'));
  }
  if (this.testMode) {
    if (!this.outbox) {
      this.outbox = [];
    }
    this.outbox.push(message);
    setTimeout(callback, 1);
    return;
  }
  if (!this.server) {
    throw new Error('smtp server not configured');
  }
  return this.server.send(message, callback);
};

module.exports = EmailSender;
