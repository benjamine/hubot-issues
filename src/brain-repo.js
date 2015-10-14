
function BrainRepo(robot, options) {
  this.robot = robot;
  options = options || {};
  this.options = options;
  options.key = options.key || 'repo';
  options.autoid = options.autoid !== false;
}

BrainRepo.prototype.load = function () {
  this.data = this.robot.brain.get(this.options.key) || [];
};

BrainRepo.prototype.save = function () {
  return this.robot.brain.set(this.options.key, this.data);
};

function unitOfWork(fn) {
  return function() {
    this.load();
    var result = fn.apply(this, arguments);
    this.save();
    return result;
  };
}

function readOnly(fn) {
  return function() {
    this.load();
    var result = fn.apply(this, arguments);
    return result;
  };
}

BrainRepo.prototype.create = unitOfWork(function(newEntity) {
  if (!newEntity.id) {
    if (!this.options.autoid) {
      throw new Error('missing entity id (and autoid is disabled)');
    }
    var newId = 1;
    this.data.forEach(function(entity) {
      if (entity.id && entity.id >= newId) {
        newId = entity.id + 1;
      }
    });
    newEntity.id = newId;
  }
  this.data.push(newEntity);
  return newEntity;
});

BrainRepo.prototype.get = readOnly(function(id) {
  for (var i = this.data.length - 1; i >= 0; i--) {
    var entity = this.data[i];
    if (entity.id === id) {
      return entity;
    }
  }
});

BrainRepo.prototype.update = unitOfWork(function(entity) {
  for (var i = this.data.length - 1; i >= 0; i--) {
    var existingEntity = this.data[i];
    if (existingEntity === entity) {
      // entity is already in the data array
      return existingEntity;
    }
    if (existingEntity.id === entity.id) {
      for (var name in existingEntity) {
        if (typeof entity[name] === 'undefined') {
          delete existingEntity[name];
        }
      }
      for (name in entity) {
        existingEntity[name] = entity[name];
      }
      return existingEntity;
    }
  }
});

BrainRepo.prototype.delete = unitOfWork(function(entityOrId) {
  var id = entityOrId;
  if (typeof entityOrId === 'object') {
    id = entityOrId.id;
  }
  for (var i = this.data.length - 1; i >= 0; i--) {
    var existingEntity = this.data[i];
    if (existingEntity === entityOrId || existingEntity.id === id) {
      this.data.splice(i, 1);
      return existingEntity;
    }
  }
});

BrainRepo.prototype.filter = readOnly(function(filter) {
  if (typeof filter !== 'function') {
    if (typeof filter !== 'object') {
      throw new Error('invalid filter, expected function or object');
    }
    filter = function(entity) {
      for (var name in filter) {
        if (filter[name] !== entity[name]) {
          return false;
        }
      }
      return true;
    };
  }
  return this.data.filter(filter);
});

BrainRepo.prototype.deleteAll = unitOfWork(function(filter) {
  if (typeof filter !== 'function') {
    if (typeof filter !== 'object') {
      throw new Error('invalid filter, expected function or object');
    }
    filter = function(entity) {
      for (var name in filter) {
        if (filter[name] !== entity[name]) {
          return false;
        }
      }
      return true;
    };
  }
  var count = 0;
  for (var i = this.data.length - 1; i >= 0; i--) {
    var existingEntity = this.data[i];
    if (filter(existingEntity)) {
      this.data.splice(i, 1);
      i--;
      count++;
    }
  }
  return {
    count: count
  };
});

module.exports = BrainRepo;
