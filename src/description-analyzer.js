
var goodIssueAdviceExample = ' (eg. actual vs. expected behavior, a screenshot could be helpful)';
var goodIssueAdvice = 'can you explain what\'s the issue?' +
    goodIssueAdviceExample;
var messages = {
  imperative: 'mmm that looks like a task, ' + goodIssueAdvice,
  question: 'is that a question? ' + goodIssueAdvice,
  'low-detail': 'can you be more specific?' + goodIssueAdviceExample
};

function analyze(description) {
  var problems = [];
  var result = {
    problems: problems
  };

  // try to detect imperative syntax
  /* jshint maxlen: 300 */
  if (/^\s*(?:please|hey|yo|hi|hello)?\s*(?:(?:can|could|would) (?:we|I|you))?\s*(make|don't|do|undo|fix|change|write|enable|disable|update|add|remove|delete|move|set|reset|replace|hide) /i.test(description)) {
    problems.push('imperative');
  }

  // try to detect low-detail
  if (/(broken|not working|doesn't work|(looks|is|seems) (really |very |so )?(bad|wrong|ugly|terrible))\s*$/i.test(description) ||
    description.split(/[\s,]+/g).length < 4) {
    problems.push('low-detail');
  }

  // try to detect questions
  if (/\?\s*$/i.test(description)) {
    problems.push('question');
  }

  if (problems.length) {
    result.message = messages[problems[0]];
  }
  result.ok = !problems.length;
  return result;
}

exports.analyze = analyze;
