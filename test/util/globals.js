global.when = function(){
  var args = Array.prototype.slice.apply(arguments);
  args[0] = 'when ' + args[0];
  describe.apply(this, args);
};
global.expect = require('expect.js');
global.hubotIssues = (typeof window !== 'undefined' ? window.hubotIssues : null) ||
  require('../../' + 'src/main.js');

require('coffee-script');
var HubotTestHelper = require('hubot-test-helper');
global.testbot = new HubotTestHelper('../../src/scripts/issues.js');
