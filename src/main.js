
// global exports

var path = require('path');
module.exports = function loadRobot(robot, scripts) {
  var scriptsPath = path.join(path.resolve(__dirname), 'scripts');
  [
    'issues'
  ].forEach(function(script){
    if (scripts && scripts.indexOf('*') < 0 && scripts.indexOf(script) < 0) {
      return;
    }
    robot.loadFile(scriptsPath, script);
  });
};

var packageInfo = require('../pack'+'age.json');
module.exports.version = packageInfo.version;
module.exports.homepage = packageInfo.homepage;
