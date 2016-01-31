var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');

function Chatter(robot) {
  this.robot = robot;
  this.listeners = [];
  this.languageSpecificListeners = [];
  this.context = [];
}

module.exports = Chatter;

Chatter.prototype.respond = function(expression, handler) {
  return this.hear(expression, handler, true);
};

Chatter.prototype.hear = function(expression, handler, respond) {
  var self = this;
  if (Array.isArray(expression)) {
    return expression.map(function(expr){
      return self.hear(expr, handler, respond);
    });
  }

  if (typeof expression === 'string') {
    if (!this.language) {
      this.loadLanguage();
    }
    if (this.language.hear && this.language.hear[expression]) {
      var regexes = this.language.hear[expression].map(function(regex) {
        return new RegExp(regex, 'i');
      });
      var languageListeners = self.hear(regexes, handler, respond);
      if (languageListeners) {
        // remember language-specific listeners to replace them on language change
        this.languageSpecificListeners.push({
          expression: expression,
          handler: handler,
          respond: respond,
          listeners: languageListeners
        });
      }
      return languageListeners;
    }
  }

  if (typeof expression === 'string') {
    if (/^@?hubot/i.test(expression)) {
      respond = true;
      expression = expression.replace(/^@?hubot:?\s*/i, '');
    }
  } else {
    var expressionSource = expression.source;
    if (/^\^?@?hubot/i.test(expressionSource)) {
      respond = true;
      expression = new RegExp(expressionSource.replace(/^@?hubot:?\s*/i, ''),
          expression.ignoreCase ? 'i' : '');
    }
  }

  this.robot[respond ? 'respond' : 'hear'](expression, function(res) {
    var args = res.match.slice();
    args[0] = res;
    handler.apply(self, args);
  });
  var listener = this.robot.listeners[this.robot.listeners.length - 1];
  this.listeners.push(listener);
  return listener;
};

Chatter.prototype.matches = function(expression, text) {
  var self = this;
  if (Array.isArray(expression)) {
    for (var i = 0; i < expression.length; i++) {
      if (self.matches(expression[i], text)) {
        return true;
      }
    }
    return false;
  }
  if (typeof expression === 'string') {
    if (!this.language) {
      this.loadLanguage();
    }
    if (this.language.hear && this.language.hear[expression]) {
      var regexes = this.language.hear[expression].map(function(regex){
        return new RegExp(regex, 'i');
      });
      return self.matches(regexes, text);
    }
  }

  return expression.test(text);
};

Chatter.prototype.removeListeners = function() {
  var robotListeners = this.robot.listeners;
  if (!robotListeners || !robotListeners.length) {
    return;
  }
  this.listeners.forEach(function(listener) {
    for (var i = 0; i < robotListeners.length; i++) {
      var robotListener = robotListeners[i];
      if (listener === robotListener) {
        robotListeners.splice(i, 1);
        i--;
      }
    }
  });
  this.listeners.length = 0;
  this.languageSpecificListeners.length = 0;
};

Chatter.prototype.setContext = function(key, value, duration) {
  // can't remember context values for more than a day
  duration = duration || (24 * 3600 * 1000);
  if (typeof value === 'undefined') {
    value = true;
  }
  var entry = {
    key: key,
    value: value,
    expiration: new Date().getTime() + duration
  };
  this.context.push(entry);
  return entry;
};

Chatter.prototype.deleteContext = function(key) {
  var entry = this.getContext(key);
  if (entry) {
    entry.expiration = new Date().getTime() - 1;
  }
  return entry;
};

Chatter.prototype.getContext = function(key) {
  var match;
  var matchLength = 0;
  var exactMatchLength = Object.keys(key).length;
  var robot = this.robot;

  function currentTime() {
    // time shift used when unit testing
    var timeShift = robot.timeHasShifted && robot.brain.get('timeShift') || 0;
    return new Date().getTime() + timeShift;
  }

  var now = currentTime();

  function isMatch(entry) {
    for (var name in entry.key) {
      if (name === 'room') {
        if (entry.key[name].toLowerCase() !== (key[name] || '').toLowerCase()) {
          return false;
        }
      } else {
        if (entry.key[name] !== key[name]) {
          return false;
        }
      }
    }
    return true;
  }

  function isExpired(entry) {
    return entry.expiration && entry.expiration <= now;
  }

  for (var i = this.context.length - 1; i >= 0; i--) {
    var entry = this.context[i];
    if (isExpired(entry)) {
      this.context.splice(i, 1);
      i--;
      continue;
    }
    var keyLength = Object.keys(entry.key).length;
    if (keyLength < matchLength || !isMatch(entry)) {
      continue;
    }
    if (exactMatchLength === keyLength) {
      // exact match
      return entry;
    }
    match = entry;
    matchLength = keyLength;
  }
  return match;
};

Chatter.prototype.setReplyContext = function(message, name, value, duration) {
  if (message.message) {
    message = message.message;
  }
  return this.setContext({
    user: message.user.name,
    room: message.room,
    name: name,
  }, value, duration || 30000);
};

Chatter.prototype.deleteReplyContext = function(message, name) {
  if (message.message) {
    message = message.message;
  }
  return this.deleteContext({
    user: message.user.name,
    room: message.room,
    name: name,
  });
};

Chatter.prototype.getReplyContext = function(message, name) {
  if (message.message) {
    message = message.message;
  }
  return this.getContext({
    user: message.user.name,
    room: message.room,
    name: name,
  });
};

Chatter.prototype.setRoomContext = function(message, name, value, duration) {
  if (message.message) {
    message = message.message;
  }
  return this.setContext({
    room: message.room,
    name: name,
  }, value, duration || 12 * 3600000);
};

Chatter.prototype.deleteRoomContext = function(message, name) {
  if (message.message) {
    message = message.message;
  }
  return this.deleteContext({
    room: message.room,
    name: name,
  });
};

Chatter.prototype.getRoomContext = function(message, name) {
  if (message.message) {
    message = message.message;
  }
  return this.getContext({
    room: message.room,
    name: name,
  });
};

function compileTemplate(text) {
  text = text.replace(/\s+/g, ' ').trim();
  return _.template(text);
}

Chatter.prototype.loadLanguage = function(name) {
  name = name || process.env.HUBOT_ISSUES_LANGUAGE || 'default';
  if (this.language && this.language.name === name) {
    return;
  }
  this.language = yaml.safeLoad(fs.readFileSync(path.join(
    __dirname, 'languages', name + '.yaml'), 'utf8'));
  for (var key in this.language.answer) {
    this.language.answer[key] = this.language.answer[key].map(compileTemplate);
  }
  this.language.name = name;

  if (this.languageSpecificListeners.length) {
    // reload listeners using the new language
    var self = this;
    this.languageSpecificListeners.forEach(function(current) {
      var newListeners = self.hear(current.expression,
        current.handler, current.respond);
      // replace existing listener with the new ones
      self.replaceListeners(current.listeners, newListeners);
    });
  }
};

Chatter.prototype.replaceListeners = function(current, replace) {
  var spliceArgs = replace.slice();
  var listeners = this.robot.listeners;
  var startAt = listeners.length;
  for (var i = listeners.length - 1; i >= 0; i--) {
    var listener = listeners[i];
    if (current.indexOf(listener) >= 0) {
      listeners.splice(i, 1);
      startAt = i;
    } else if (replace.indexOf(listener) >= 0) {
      listeners.splice(i, 1);
    }
  }
  spliceArgs.unshift(startAt, 0);
  listeners.splice.apply(listeners, spliceArgs);
};

Chatter.prototype.renderMessage = function(res, message, data) {
  if (!this.language) {
    this.loadLanguage();
  }
  var templateList = this.language.answer[message];
  var template;
  if (templateList) {
    template = templateList[Math.floor(Math.random() * templateList.length)];
  } else {
    template = compileTemplate(message);
  }
  data = data || {};
  if (res) {
    data.user = data.user || res.message.user.name;
    data.room = data.room || res.message.room;
  }
  var output = template(data).trim();
  return output;
};

Chatter.prototype.send = function(res, message, data) {
  var text = this.renderMessage(res, message, data);
  return res.send(text);
};
