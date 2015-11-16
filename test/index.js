/*
* mocha's bdd syntax is inspired in RSpec
*   please read: http://betterspecs.org/
*/
require('./util/globals');

var yaml = require('js-yaml');
var fs = require('fs');
var path  = require('path');
var chalk = require('chalk');
var brainCleanup = require('./fixtures/brain-cleanup');

var debug = !process.env.SILENT;

function log(text) {
  if (!debug) {
    return;
  }
  console.log('      ' + chalk.cyan(text));
}
function logError(text) {
  if (!debug) {
    return;
  }
  console.log('      ' + chalk.red(text));
}

var responseTimeout = 2000;

describe('hubotIssues', function(){
  it('has a semver version', function(){
    expect(hubotIssues.version).to.match(/^\d+\.\d+\.\d+(-.*)?$/);
  });

  beforeEach(function(){
    this.room = testbot.createRoom({
      name: 'engineering'
    });
    this.room.nextMessageToValidate = 0;
  });
  afterEach(function(){
    this.room.destroy();
  });

  function validateNextMessage(author, text) {
    var message = this.room.messages[this.room.nextMessageToValidate];
    try {
      expect(message).to.eql([author, text]);
    } catch(err) {
      logError('error checking message #' + this.room.nextMessageToValidate + '\n' +
        '       messages:\n' + this.room.messages.map(function(msg){
          return '         ' + msg[0] + '> ' + msg[1];
        }).join('\n'));
      throw err;
    }
    log('(' + (this.room.nextMessageToValidate + 1) + ') ' + message[0] + '> ' + message[1]);
    this.room.nextMessageToValidate++;
  }

  function hubotShouldSay(text) {
    var self = this;
    // unescape chars
    text = text.replace(/\\n\s*/gm, '\n');
    return function() {
      return new Promise(function(resolve, reject) {
        var startTime = new Date().getTime();
        function checkNextMessage() {
          var nextMessage = self.room.messages[self.room.nextMessageToValidate];
          if (!nextMessage) {
            if (new Date().getTime() - startTime > responseTimeout) {
              reject(new Error('timeout waiting for hubot response'));
              return;
            }
            setTimeout(checkNextMessage, 50);
            return;
          }
          try {
            validateNextMessage.call(self, 'hubot', text);
          } catch(err) {
            return reject(err);
          }
          resolve();
        }
        checkNextMessage();
      });
    };
  }

  function userSays(name, text) {
    var self = this;
    return function(){
      return self.room.user.say(name, text).then(function(){
        validateNextMessage.call(self, name, text);
      });
    };
  }

  function brainCheck(expected) {
    var brain = this.room.robot.brain;
    return function() {
      return new Promise(function(resolve, reject) {
        try {
          for (var name in expected) {
            var actual = brainCleanup(brain.get(name));
            expect(actual).to.eql(expected[name]);
          }
        } catch(err) {
          return reject(err);
        }
        log('brain check OK');
        resolve();
      });
    };
  }

  function shiftTime(quantity, unit) {
    if (/^(a|an)$/i.test(quantity)) {
      quantity = 1;
    } else {
      quantity = +quantity;
    }

    var unitSeconds = 1;
    switch (unit) {
      case 'minute':
        unitSeconds = 60;
        break;
      case 'hour':
        unitSeconds = 3600;
        break;
      case 'day':
        unitSeconds = 24 * 3600;
        break;
      case 'week':
        unitSeconds = 7 * 24 * 3600;
        break;
      case 'month':
        unitSeconds = 30 * 24 * 3600;
        break;
      case 'year':
        unitSeconds = 365 * 24 * 3600;
        break;
    }

    var robot = this.room.robot;
    var brain = robot.brain;
    var totalTime = quantity * unitSeconds * 1000;
    return function() {
      return new Promise(function(resolve) {
        var currentTimeShift = robot.timeHasShifted && brain.get('timeShift') || 0;
        brain.set('timeShift', currentTimeShift + totalTime);
        robot.timeHasShifted = true;
        log(quantity + ' ' + unit + '(s) later');
        resolve();
      });
    };
  }

  function parseFixtureItems(items, done) {
    var fullPromise;
    function nextPromise(promiseGetter) {
      if (!fullPromise) {
        fullPromise = promiseGetter();
        return;
      }
      fullPromise = fullPromise.then(promiseGetter);
    }
    items.forEach(function(item){
      if (typeof item === 'string') {
        var timeShift = /^(\d+|a|an) (second|minute|hour|day|week|month|year)s? later$/i.exec(item);
        if (timeShift) {
          nextPromise(shiftTime.call(this, timeShift[1], timeShift[2]));
          return;
        }
        var message = /([^>]+)> ?([\s\S]+)$/.exec(item);
        if (!message) {
          throw new Error('invalid chat message: ' + item);
        }
        var author = message[1].trim();
        var text = message[2].trim();
        if (author === 'hubot') {
          // hubot should say this
          nextPromise(hubotShouldSay.call(this, text));
        } else {
          // someone else is saying this
          nextPromise(userSays.call(this, author, text));
        }
        return;
      } else if (typeof item === 'object') {
        if (item.brain) {
          // asset brain data
          nextPromise(brainCheck.call(this, item.brain));
        }
        return;
      }
      throw new Error('invalid fixture item type: ' + (typeof item));
    }.bind(this));

    if (!fullPromise) {
      return done();
    }
    return fullPromise.then(function() {
      done();
    }, function(err) {
      done(err);
    });
  }

  function parseFixtureStep(name, value) {
    if (name === 'before each') {
      if (!Array.isArray(value)) {
        throw new Error('before each: should be an array');
      }
      beforeEach(function(done){
        parseFixtureItems.call(this, value, done);
      });
      return;
    }
    if (Array.isArray(value)) {
      it(name, function(done) {
        parseFixtureItems.call(this, value, done);
      });
    } else {
      describe(name, function(done){
        parseFixture.call(this, value, done);
      });
    }
  }

  function parseFixture(node) {
    for (var name in node) {
      var value = node[name];
      parseFixtureStep(name, value);
    }
  }

  var conversations = yaml.safeLoad(fs.readFileSync(path.join(__dirname,
    'fixtures', 'conversations.yaml'), 'utf8'));
  parseFixture.call(this, conversations);
});
