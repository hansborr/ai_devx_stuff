/** @type {import('@commitlint/types').UserConfig} */
const bodyWithoutTrailers = (body) => {
  const lines = (body ?? '').split(/\r?\n/);
  const trailerLine = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+:\s+\S/;

  while (lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  while (trailerLine.test(lines.at(-1)?.trim() ?? '')) {
    lines.pop();
  }

  while (lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines.join('\n').trim();
};

const bodyShapeRules = {
  rules: {
    'body-empty': (parsed, when = 'always') => {
      const bodyIsEmpty = bodyWithoutTrailers(parsed.body).length === 0;

      return [
        when === 'never' ? !bodyIsEmpty : bodyIsEmpty,
        `body ${when === 'never' ? 'may not' : 'must'} be empty`,
      ];
    },
    'body-min-length': (parsed, when = 'always', value = 0) => {
      const bodyLengthIsEnough = bodyWithoutTrailers(parsed.body).length >= value;

      return [
        when === 'never' ? !bodyLengthIsEnough : bodyLengthIsEnough,
        `body must not be shorter than ${value} characters`,
      ];
    },
  },
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [bodyShapeRules],
  rules: {
    'subject-min-length': [2, 'always', 20],
    'subject-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'body-empty': [2, 'never'],
    'body-min-length': [2, 'always', 40],
    'body-max-line-length': [0, 'always', 100],
    'footer-leading-blank': [0, 'always'],
    'footer-max-line-length': [0, 'always', 100],
  },
};
