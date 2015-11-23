// Description:
//   hubot issue tracking
//
// Commands:
//   hubot how do you track issues? - Reply with instructions
//
// Author:
//  Benjamin Eidelman <beneidel@gmail.com>
//
module.exports = function(robot) {

  var _ = require('lodash');
  var BrainRepo = require('../brain-repo');
  var repo = new BrainRepo(robot, { key: 'hubotissues' });
  var settingsRepo = new BrainRepo(robot, { key: 'hubotissuessettings' });
  var Chatter = require('../chatter');
  var chatter = new Chatter(robot);
  var descriptionAnalyzer = require('../description-analyzer');

  /* introduction */

  chatter.hear('that might be a bug', function(res, thing) {
    if (chatter.matches('I found a bug', res.match[0])) {
      // a bug that will be tracked
      return;
    }
    if (thing) {
      this.send(res, 'maybe you found a bug on', { thing: thing });
    } else {
      this.send(res, 'maybe you found a bug');
    }
    this.setReplyContext(res, 'maybefoundabug', true);
  });

  chatter.hear('yes, please, how?', function(res) {
    if (this.getReplyContext(res, 'maybefoundabug')) {
      this.deleteReplyContext(res, 'maybefoundabug');
      this.send(res, 'say I found a bug');
    }
  });

  chatter.hear('how do I track bugs?', function(res) {
    this.send(res, 'say I found a bug');
  });

  function getRoomSettings(room) {
    var rooms = settingsRepo.get('rooms');
    if (!rooms) {
      return {};
    }
    return rooms.list[room] || {};
  }

  function saveRoomSettings(room, settings) {
    var rooms = settingsRepo.get('rooms');
    if (!rooms) {
      rooms = settingsRepo.create({
        id: 'rooms',
        list: []
      });
    }
    var update = false;
    if (!rooms.list[room]) {
      rooms.list[room] = settings;
      update = true;
    } else {
      var roomSettings = rooms.list[room];
      Object.keys(settings).forEach(function(key) {
        if (roomSettings[key] !== settings[key]) {
          roomSettings[key] = settings[key];
          update = true;
        }
      });
    }
    if (update) {
      settingsRepo.update(rooms);
    }
    return rooms.list[room];
  }

  /* creating */

  chatter.hear('I found a bug', function(res, description) {

    var analysis = descriptionAnalyzer.analyze(description);
    if (analysis.message) {
      res.send(analysis.message);
      return;
    }

    var issue = repo.create({
      description: description,
      author: res.message.user.name,
      createdAt: currentTime(),
      lastMentionAt: currentTime(),
      state: 'pending'
    });
    this.setRoomContext(res, 'issueid', issue.id);
    saveRoomSettings(res.message.room, { notifications: true });
    this.send(res, 'issue created', { issue: issue });
  });

  robot.router.post('/hubot/issues', function(req, res)  {
    var data = req.body.payload ? JSON.parse(req.body.payload) : req.body;
    var token = data.token || req.query.token;
    if (process.env.HUBOT_ISSUES_HTTP_TOKEN && process.env.HUBOT_ISSUES_HTTP_TOKEN !== token) {
      res.send(403, 'Not Authorized');
      return;
    }
    if (!data.description) {
      res.send(400, 'description is required');
    }

    var issue = repo.create({
      description: data.description,
      author: data.author || 'anonymous',
      createdAt: currentTime(),
      lastMentionAt: currentTime(),
      state: 'pending'
    });
    if (data.room) {
      chatter.setRoomContext({ room: data.room }, 'issueid', issue.id);
      saveRoomSettings(data.room, { notifications: true });
      robot.messageRoom(data.room, chatter.renderMessage(null, 'issue created from http' +
        (data.author ? '' : ' anonymous'), { issue: issue }));
    }
    res.send(201, 'Created');
  });

  /* listing */

  function formatList(res, issues) {
    var issuesByState = _.groupBy(issues, 'state');
    var list = [];
    var states = Object.keys(issuesByState);
    _.sortBy(states, function(state) {
      switch(state) {
        case 'pending':
          return 0;
        case 'fixed':
          return 1;
        case 'verified':
          return 9;
        default:
          return 8;
      }
    });
    states.forEach(function(state){
      /* jshint loopfunc: true */
      var groupIssues = issuesByState[state];
      var group = {
        name: state,
        count: groupIssues.length
      };
      list.push(chatter.renderMessage(res, 'list group', {
        group: group
      }));
      if (state === 'pending') {
        _.sortBy(groupIssues, 'assignee');
      }
      groupIssues.forEach(function(issue) {
        list.push(chatter.renderMessage(res, 'list issue', {
          group: group,
          issue: issue,
          tags: stringifyTags(issue.tags)
        }));
      });
    });
    return list.join('\n');
  }

  chatter.hear('what\'s broken?', function(res, type) {
    type = (type || '').trim().toLowerCase();
    if (type === 'all') {
      type = '';
    }

    if (type === 'my' || / my$/i.test(type)) {
      return;
    }

    if (/delete/.test(type)) {
      // this is a delete command
      return;
    }

    var issues = repo.filter(function(issue){
      if (type) {
        if (issue.state === type) {
          return true;
        }
        if (issue.tags && issue.tags.indexOf(type) >= 0) {
          return true;
        }
      } else {
        return issue.state !== 'verified';
      }
    });

    if (issues.length < 1) {
      if (!type || /^(pending|all)$/i.test(type)) {
        this.send(res, 'no more issues');
        return;
      }
      this.send(res, 'list empty', { type: type });
      return;
    }
    res.send(formatList(res, issues));
  });

  chatter.hear('what can I do next?', function(res) {

    var user = res.message.user.name;
    var issues = repo.filter(function(issue){
      if (issue.author === user && issue.state !== 'fixed') {
        return true;
      }
      if (issue.assignee === user && issue.state === 'pending') {
        return true;
      }
      return false;
    });
    if (issues.length < 1) {
      issues = repo.filter(function(issue) {
        return issue.state === 'pending' && !issue.assignee;
      });
    }

    if (issues.length < 1) {
      this.send(res, 'your list empty');
      return;
    }
    res.send(formatList(res, issues));
  });

  /* assign */

  chatter.hear('I\'m fixing that', function(res, id) {

    if (!id) {
      id = 'that';
    }
    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      var context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    if (issue.state !== 'pending') {
      this.send(res, 'cannot assign, issue is not pending', { issue: issue });
      return;
    }
    if (issue.assignee === res.message.user.name) {
      this.send(res, 'issue already assigned to you', { issue: issue });
      return;
    }
    if (issue.assignee) {
      this.send(res, 'issue already assigned to someone else', { issue: issue });
      return;
    }
    issue.assignee = res.message.user.name;
    issue.lastMentionAt = currentTime();
    repo.update(issue);
    this.setRoomContext(res, 'issueid', issue.id);
    this.send(res, 'issue assigned', { issue: issue });
  });

  chatter.hear('I\'m not fixing that', function(res, id) {

    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      var context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    if (issue.assignee !== res.message.user.name) {
      this.send(res, 'issue already not assigned to you', { issue: issue });
      return;
    }
    delete issue.assignee;
    repo.update(issue);
    this.setRoomContext(res, 'issueid', issue.id);
    this.send(res, 'issue unassigned', { issue: issue });
  });

  /* fixed */

  chatter.hear('I fixed that', function(res, id) {

    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      var context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    if (issue.state !== 'pending') {
      this.send(res, 'cannot fix, issue is not pending', { issue: issue });
      return;
    }
    if (issue.assignee && issue.assignee !== res.message.user.name) {
      this.send(res, 'issue was being fixed by someone else', { issue: issue });
    }

    this.setRoomContext(res, 'issueid', issue.id);
    issue.assignee = res.message.user.name;
    issue.lastMentionAt = currentTime();
    repo.update(issue);
    if (issue.assignee === issue.author) {
      // autofix, consider it verified
      issue.state = 'verified';
      issue.stateChangedAt = currentTime();
      repo.update(issue);
      this.send(res, 'issue fixed by author', { issue: issue });
      return;
    }
    issue.state = 'fixed';
    issue.stateChangedAt = currentTime();
    repo.update(issue);
    var pendingIssues = repo.filter(function(issue) {
      return issue.state === 'pending';
    });
    this.send(res, 'issue fixed', { issue: issue, pendingIssues: pendingIssues });
  });

  /* clarification */

  chatter.hear('needs clarification', function(res, id, question) {

    if (!id) {
      id = 'that';
    }

    var context;
    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    this.setRoomContext(res, 'issueid', issue.id);
    if (question) {
      issue.log = issue.log || [];
      issue.log.push(res.message.user.name + '> ' + question);
      repo.update(issue);
      this.send(res, 'issue needs clarification, can author answer?', { issue: issue });
    } else {
      this.setReplyContext(res, 'needsClarificationId', issue.id);
      this.send(res, 'issue needs clarification, what\'s your question?', { issue: issue });
    }
  });

  chatter.hear([
    /^([\s\S]+)\?$/i,
  ], function(res, question) {

    var context;
    var issue;

    context = this.getReplyContext(res, 'needsClarificationId');
    if (context && context.value) {
      issue = repo.get(context.value);
      if (issue) {
        issue.log = issue.log || [];
        issue.log.push(res.message.user.name + '> ' + question);
        issue.lastMentionAt = currentTime();
        repo.update(issue);
        this.send(res, 'issue needs clarification, can author answer?', { issue: issue });
      }
      this.setReplyContext(res, 'needsClarificationId', null);
      return;
    }

  });

  /* commenting */

  chatter.hear('about that', function(res, id, comment) {

    if (!id) {
      id = 'that';
    }

    var context;
    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    this.setRoomContext(res, 'issueid', issue.id);

    if (context && !res.match[1] && issue.author !== res.message.user.name) {
      // only author can comment using "also|and|but"
      return;
    }

    if (comment && comment.trim()) {
      issue.log = issue.log || [];
      issue.log.push(res.message.user.name + '> ' + comment);
      issue.lastMentionAt = currentTime();
      repo.update(issue);
      this.send(res, 'comment added', { issue: issue, comment: comment });
    } else {
      this.setReplyContext(res, 'addingCommentId', issue.id);
      this.send(res, 'comment, what?', { issue: issue });
    }
  });

  chatter.hear([
    /^([\s\S]+)$/i,
  ], function(res, comment) {

    if (chatter.matches('about that', res.match[0])) {
      return;
    }

    var context;
    var issue;

    context = this.getReplyContext(res, 'rejectReasonForId');
    if (context && context.value) {
      issue = repo.get(context.value);
      if (issue) {
        issue.log = issue.log || [];
        issue.log.push(res.message.user.name + '> ' + comment);
        issue.lastMentionAt = currentTime();
        repo.update(issue);
        this.send(res, 'rejected fix, got reason', { issue: issue });
      }
      this.setReplyContext(res, 'needsClarificationId', null);
      return;
    }

    context = this.getReplyContext(res, 'addingCommentId');
    if (!context || !context.value) {
      return;
    }
    if (chatter.matches('nevermind', comment.trim())) {
      this.setReplyContext(res, 'addingCommentId', null);
      return;
    }
    issue = repo.get(context.value);
    if (issue) {
      issue.log = issue.log || [];
      issue.log.push(res.message.user.name + '> ' + comment);
      issue.lastMentionAt = currentTime();
      repo.update(issue);
      this.send(res, 'comment added', { issue: issue, comment: comment });
    }
    this.setReplyContext(res, 'addingCommentId', null);
  });

  /* tags */

  function parseTags(tagString) {
    if (!tagString) {
      return [];
    }
    return tagString.split(/(?:,|and)/gim).map(function(tag){
      return tag.toLowerCase().trim().replace(/^#/, '');
    }).filter(function(tag){
      return /\w/i.test(tag) &&
      !/^((?:a )?dup(?:licate)? of|same as)/.test(tag) &&
      [
        'pending', 'fixing', 'fixed', 'done', 'solved', 'ok now', 'gone', 'rejected', 'verified', 'dup', 'duplicate'
      ].indexOf(tag.replace(/^not /, '')) < 0;
    });
  }

  function stringifyTags(tags, prefix) {
    if (!tags) {
      return '';
    }
    if (typeof prefix === 'undefined') {
      prefix = '#';
    }
    if (tags.length < 2) {
      return prefix + tags[0];
    }
    return '#' + tags.slice(0, -1).join(', #') +
      ' and #' + tags[tags.length - 1];
  }

  chatter.hear('that is tag', function(res, id, tagString) {

    var tags = parseTags(tagString);
    if (!tags || !tags.length) {
      return;
    }

    id = id.toLowerCase().trim();
    var ids;
    if (/[ ,]/.test(id)) {
      // multiple ids
      ids = id.split(/[ ,]+/g).map(function(anId) {
        return anId.replace(/[ ,\#]+/g, '');
      }).filter(function(anId) {
        return anId !== 'and';
      });
    } else {
      ids = [id];
    }

    function applyTags(tags, issue) {
      var tagsChanged = false;
      tags.forEach(function(tag) {
        if (/^not /.test(tag)) {
          for (var i = 0; i < issue.tags.length; i++) {
            if ('not ' + issue.tags[i] === tag) {
              issue.tags.splice(i, 1);
              i--;
              tagsChanged = true;
            }
          }
          if (issue.tags.length < 1) {
            delete issue.tags;
          }
        } else {
          issue.tags = issue.tags || [];
          if (issue.tags.indexOf(tag) < 0) {
            issue.tags.push(tag);
            tagsChanged = true;
          }
        }
      });
      return tagsChanged;
    }

    var context;
    for (var i = 0; i < ids.length; i++) {
      if (['that', 'it'].indexOf(ids[i].toLowerCase()) >= 0) {
        context = this.getRoomContext(res, 'issueid');
        if (context && context.value) {
          ids[i] = context.value;
        } else {
          this.send(res, 'issue not found in context', { ref: ids[i] });
          return;
        }
      }

      var issue = repo.get(+ids[i]);
      if (!issue) {
        this.send(res, 'issue not found', { id: ids[i] });
        return;
      }
      if (ids.length < 2) {
        this.setRoomContext(res, 'issueid', issue.id);
      }

      var tagsChanged = applyTags(tags, issue);
      if (tagsChanged) {
        issue.lastMentionAt = currentTime();
        repo.update(issue);
      }
      if (ids.length < 2) {
        if (issue.tags && issue.tags.length) {
          this.send(res, 'issue tagged', { issue: issue, tags: stringifyTags(issue.tags) });
        } else {
          this.send(res, 'issue has no tags', { issue: issue });
        }
      }
    }

    if (ids.length > 1) {
      this.send(res, 'issues tagged', { issues: stringifyTags(ids), tags: stringifyTags(tags) });
    }
  });

  /* duplicates */

  chatter.hear('duplicate', function(res, duplicateId) {

    if (!duplicateId) {
      duplicateId = 'that';
    }

    var context;
    if (['that', 'it'].indexOf(duplicateId.toLowerCase()) >= 0) {
      context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        duplicateId = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: duplicateId });
        return;
      }
    }

    this.setRoomContext(res, 'issueid', duplicateId);
    this.setReplyContext(res, 'duplicateId', duplicateId);
    this.send(res, 'duplicate of which?', { id: duplicateId });
  });

  chatter.hear('duplicate of', function(res, duplicateId, id) {

    var context;

    if (duplicateId.toLowerCase() === 'of') {
      context = this.getReplyContext(res, 'duplicateId');
      if (!context) {
        return;
      }
      duplicateId = context.value.toString();
    }

    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      if (['that', 'it'].indexOf(duplicateId.toLowerCase()) >= 0) {
        this.send(res, 'that duplicate of that?', { duplicateRef: duplicateId, ref: id });
        return;
      }
      context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }
    if (['that', 'it'].indexOf(duplicateId.toLowerCase()) >= 0) {
      context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        duplicateId = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: duplicateId });
        return;
      }
    }

    if (+id === +duplicateId) {
      this.send(res, 'issue duplicate of itself?', { ref: id });
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    var duplicate = repo.get(+duplicateId);
    if (!duplicate) {
      this.send(res, 'issue not found', { id: duplicateId });
      return;
    }

    issue.log = issue.log || [];
    issue.log.push(duplicate.author + '> ' + duplicate.description + ' (ex #' + duplicate.id + ')');
    issue.lastMentionAt = currentTime();
    repo.update(issue);
    repo.delete(duplicate);

    this.setRoomContext(res, 'issueid', issue.id);
    this.send(res, 'issue duplicate deleted', { duplicate: duplicate, issue: issue });
  });

  /* issue details */

  chatter.hear('tell me about that', function(res, id) {

    if (/^(\d+|that|it)$/.test(res.match[0])) {
      // just a number or word, it's probably not a question for me
      return;
    }
    var context;
    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    this.setRoomContext(res, 'issueid', issue.id);
    var output = [this.renderMessage(res, 'issue details', { issue: issue, tags: stringifyTags(issue.tags) })];
    if (issue.log) {
      issue.log.forEach(function(text){
        output.push(chatter.renderMessage(res, 'issue details log entry', { issue: issue, text: text }));
      });
    }
    issue.lastMentionAt = currentTime();
    repo.update(issue);
    res.send(output.join('\n'));
  });

  /* reject */

  chatter.hear('reject that', function(res, id, reason) {

    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      var context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    this.setRoomContext(res, 'issueid', issue.id);
    if (issue.state !== 'fixed') {
      this.send(res, 'cannot reject, issue is not fixed', { issue: issue });
      return;
    }
    issue.state = 'pending';
    issue.stateChangedAt = currentTime();
    issue.lastMentionAt = currentTime();
    if (reason) {
      issue.log = issue.log || [];
      issue.log.push(res.message.user.name + '> ' + reason);
    }
    repo.update(issue);
    if (issue.assignee && issue.assignee === res.message.user.name) {
      this.send(res, 'rejected your fix', { issue: issue, reason: reason });
    } else {
      this.send(res, reason ? 'rejected fix' : 'rejected fix, no reason',
        { issue: issue, reason: reason });
      if (!reason) {
        this.setReplyContext(res, 'rejectReasonForId', issue.id);
      }
    }
  });

  /* verify */

  chatter.hear('verified that', function(res, id) {

    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      var context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    this.setRoomContext(res, 'issueid', issue.id);
    if (issue.author !== 'anonymous' && issue.author !== res.message.user.name) {
      this.send(res, 'only author can verify', { issue: issue });
    }
    if (issue.state !== 'fixed') {
      this.send(res, 'cannot verify, issue is not fixed', { issue: issue });
      return;
    }
    issue.state = 'verified';
    issue.stateChangedAt = currentTime();
    issue.lastMentionAt = currentTime();
    repo.update(issue);
    this.send(res, 'verified fix', { issue: issue });

    if (!this.getContext({ name: 'garbageCollected'})) {
      this.setContext({ name: 'garbageCollected'}, true, 12 * 60 * 60000);
      repo.deleteAll(function(issue) {
        // delete verified issues after 24hs
        return issue.state === 'verified' && hoursSince(issue.lastMentionAt) > 24;
      });
    }

  });

  /* delete */

  chatter.hear('delete that', function(res, id) {

    if (['that', 'it'].indexOf(id.toLowerCase()) >= 0) {
      var context = this.getRoomContext(res, 'issueid');
      if (context && context.value) {
        id = context.value;
      } else {
        this.send(res, 'issue not found in context', { ref: id });
        return;
      }
    }

    var issue = repo.get(+id);
    if (!issue) {
      this.send(res, 'issue not found', { id: id });
      return;
    }
    this.setRoomContext(res, 'issueid', issue.id);
    repo.delete(issue);
    this.send(res, issue.author === res.message.user.name ?
      'issue deleted by author' : 'issue deleted', { issue: issue });
  });

  chatter.hear('delete verified', function(res) {
    var count = repo.deleteAll({ state: 'verified' }).count;
    this.send(res, 'issues deleted', { count: count });
  });

  /* notifications */

  function currentTime() {
    // time shift used when unit testing
    var timeShift = robot.timeHasShifted && robot.brain.get('timeShift') || 0;
    return new Date().getTime() + timeShift;
  }

  function timeSince(date) {
    var time = typeof date === 'number' ? date : date.getTime();
    return currentTime() - time;
  }

  function hoursSince(date) {
    return timeSince(date) / 1000 / 3600;
  }

  chatter.hear([
    /^.*$/i,
  ], function(res) {

    if (this.getContext({ name: 'noNotifications'})) {
      return;
    }

    var roomSettings = getRoomSettings(res.message.room);
    if (!roomSettings.notifications) {
      return;
    }

    var issues = repo.filter(function(issue){
      return issue.state !== 'verified' && hoursSince(issue.lastMentionAt) > 4;
    });

    if (!issues.length) {
      // no issues to notify about, don't look again for 30min
      this.setContext({ name: 'noNotifications'}, true, 30 * 1000);
      return;
    }

    var user = res.message.user.name;
    issues = issues.filter(function(issue){
      var hoursSinceLastMention = hoursSince(issue.lastMentionAt);
      if (issue.state === 'fixed' && issue.author === user && hoursSinceLastMention > 4) {
        return true;
      }
      if (issue.state === 'pending' && issue.assignee === user && hoursSinceLastMention > 8) {
        return true;
      }
    });
    var personalIssues = issues && issues.length;
    if (!personalIssues) {
      issues = repo.filter(function(issue){
        // issues that have been pending for a long time,
        var hoursSinceLastMention = hoursSince(issue.lastMentionAt);
        return issue.state === 'pending' && !issue.assignee && hoursSinceLastMention > 22;
      });
    }
    if (!issues.length) {
      return;
    }

    if (issues.length === 1) {
      this.setRoomContext(res, 'issueid', issues[0].id);
    }

    issues.forEach(function(issue) {
      issue.lastMentionAt = currentTime();
      repo.update(issue);
    });
    if (personalIssues) {
      var issuesList = stringifyTags(issues.map(function(issue) {
        return issue.id.toString();
      }));
      this.send(res, issues.length === 1 ?
        'issue waiting for your ' + (issues[0].state === 'fixed' ? 'verification' : 'fix') :
        'issues waiting for you', {
          issue: issues[0],
          issues: issues,
          issuesList: issuesList,
          pending: issues.filter(function(issue) {
            return issue.state === 'pending';
          }),
          fixed: issues.filter(function(issue) {
            return issue.state === 'fixed';
          })
        }
      );
    } else {
      this.send(res, issues.length === 1 ? 'pending issue waiting' : 'pending issues waiting',
        { issues: issues });
    }
  });

  /* settings */

  chatter.hear('no notifications here', function(res) {
    saveRoomSettings(res.message.room, {
      notifications: false
    });
    this.send(res, 'notifications off');
  });

  chatter.hear('do notifications here', function(res) {
    saveRoomSettings(res.message.room, {
      notifications: true
    });
    this.send(res, 'notifications on');
  });

};
