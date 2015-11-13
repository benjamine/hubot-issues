function brainCleanup(data) {
  if (Array.isArray(data)) {
    data.forEach(brainCleanup);
    return data;
  }
  if (typeof data === 'object') {
    var keys = Object.keys(data);
    keys.forEach(function(key) {
      if (['createdAt', 'stateChangedAt', 'lastMentionAt'].indexOf(key) >= 0) {
        delete data[key];
      } else if (typeof data[key] === 'object') {
        brainCleanup(data[key]);
      }
    });
  }
  return data;
}

module.exports = brainCleanup;
