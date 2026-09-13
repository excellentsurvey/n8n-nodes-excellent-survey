'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { ExcellentSurveyTrigger } = require('../dist/nodes/ExcellentSurvey/ExcellentSurveyTrigger.node');
const { ExcellentSurveyOAuth2Api } = require('../dist/credentials/ExcellentSurveyOAuth2Api.credentials');
const { responseRecord } = require('../dist/nodes/ExcellentSurvey/response');
const fixture = require('./fixtures/response.json');
const node = new ExcellentSurveyTrigger();
const hook = node.webhookMethods.default;
const workflowNode = { id: 'node_fixture', name: 'Excellent Survey Trigger', type: 'excellentSurveyTrigger', typeVersion: 1, position: [0, 0], parameters: {} };

function context({ url = 'https://n8n.example.org/webhook/test-instance', surveyId = fixture.survey.id, store = {}, responses = [] } = {}) {
  const calls = [];
  return {
    calls, store,
    getNode: () => workflowNode,
    getNodeParameter: () => surveyId,
    getNodeWebhookUrl: () => url,
    getWorkflowStaticData: () => store,
    helpers: {
      async httpRequestWithAuthentication(credential, options) {
        calls.push({ credential, ...options });
        assert.equal(credential, 'excellentSurveyOAuth2Api');
        assert.ok(options.url.startsWith('https://excellentsurvey.com/api/connect/v1/'));
        assert.ok(responses.length, 'Unexpected network request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}
test('OAuth credential uses platform refresh flow and bundles no client ID or secret', () => {
  const credential = new ExcellentSurveyOAuth2Api();
  assert.deepEqual(credential.extends, ['oAuth2Api']);
  assert.equal(credential.properties.find(p => p.name === 'accessTokenUrl').default, 'https://excellentsurvey.com/api/connect/token');
  assert.equal(credential.properties.some(p => ['clientSecret', 'clientId', 'apiKey'].includes(p.name)), false);
});
test('survey dropdown retains actual titles and stable IDs', async () => {
  const ctx = context({ responses: [{ surveys: [{ id: fixture.survey.id, title: fixture.survey.title }] }] });
  assert.deepEqual(await node.methods.loadOptions.getSurveys.call(ctx), [{ name: fixture.survey.title, value: fixture.survey.id }]);
});
test('activate/check/deactivate manages only this generated callback', async () => {
  const ctx = context({ responses: [{ id: 'sub_one' }, { subscriptions: [{ id: 'sub_other', surveyId: fixture.survey.id }, { id: 'sub_one', surveyId: fixture.survey.id }] }, undefined] });
  assert.equal(await hook.checkExists.call(ctx), false);
  assert.equal(await hook.create.call(ctx), true);
  assert.deepEqual(ctx.calls[0].body, { surveyId: fixture.survey.id, url: ctx.getNodeWebhookUrl() });
  assert.equal(await hook.checkExists.call(ctx), true);
  assert.equal(await hook.delete.call(ctx), true);
  assert.equal(ctx.calls.at(-1).url, 'https://excellentsurvey.com/api/connect/v1/subscriptions/sub_one');
  assert.deepEqual(ctx.store, {});
  assert.equal(await hook.delete.call(ctx), true);
});
test('test listener and production subscriptions cannot overwrite or remove each other', async () => {
  const store = {};
  const live = context({ store, responses: [{ id: 'sub_live' }] });
  const testing = context({ store, url: 'https://n8n.example.org/webhook-test/test-instance', responses: [{ id: 'sub_test' }, undefined] });
  await hook.create.call(live); await hook.create.call(testing);
  assert.equal(Object.keys(store).length, 2);
  await hook.delete.call(testing);
  assert.equal(Object.keys(store).length, 1);
  assert.equal(Object.values(store)[0].id, 'sub_live');
});
test('changing survey removes the previous callback subscription before registering new selection', async () => {
  const store = {};
  await hook.create.call(context({ store, responses: [{ id: 'old' }] }));
  const ctx = context({ store, surveyId: 'new_survey', responses: [undefined, { id: 'new' }] });
  assert.equal(await hook.checkExists.call(ctx), false);
  await hook.create.call(ctx);
  assert.equal(ctx.calls[0].method, 'DELETE'); assert.ok(ctx.calls[0].url.endsWith('/old'));
  assert.equal(ctx.calls[1].body.surveyId, 'new_survey');
});
test('failed deletion retains subscription state and surfaces error for retry', async () => {
  const store = {};
  await hook.create.call(context({ store, responses: [{ id: 'keep_for_retry' }] }));
  await assert.rejects(hook.delete.call(context({ store, responses: [new Error('Service unavailable')] })), /Service unavailable/);
  assert.equal(Object.values(store)[0].id, 'keep_for_retry');
});
test('deactivation can remove a saved subscription after the survey selection is cleared', async () => {
  const store = {};
  await hook.create.call(context({ store, responses: [{ id: 'saved' }] }));
  const ctx = context({ store, surveyId: '', responses: [undefined] });
  await hook.delete.call(ctx);
  assert.ok(ctx.calls[0].url.endsWith('/saved'));
  assert.deepEqual(store, {});
});
test('authorization and rate-limit responses use n8n API errors with recovery guidance', async () => {
  for (const [statusCode, hint] of [[401, /Reconnect/], [403, /approve/], [429, /Wait/]]) {
    const failure = Object.assign(new Error('Request rejected'), { statusCode });
    const ctx = context({ responses: [failure] });
    await assert.rejects(node.methods.loadOptions.getSurveys.call(ctx), error => {
      assert.ok(error instanceof NodeApiError);
      assert.equal(error.httpCode, String(statusCode));
      assert.match(error.description, hint);
      return true;
    });
  }
});
test('public HTTPS callback is required before any registration request', async () => {
  for (const url of ['http://localhost:5678/webhook/node', 'not a URL', 'https://user:password@n8n.example.org/webhook/node']) {
    const ctx = context({ url });
    await assert.rejects(hook.create.call(ctx), error => {
      assert.ok(error instanceof NodeOperationError);
      assert.match(error.description, /public HTTPS/);
      return true;
    });
    assert.equal(ctx.calls.length, 0);
  }
});
test('empty survey selection and malformed API data fail without saving invalid state', async () => {
  const emptySurvey = context({ surveyId: '' });
  await assert.rejects(hook.create.call(emptySurvey), /survey must be selected/);
  assert.equal(emptySurvey.calls.length, 0);
  const malformed = context({ responses: [null] });
  await assert.rejects(hook.create.call(malformed), /did not confirm/);
  assert.deepEqual(malformed.store, {});
  await assert.rejects(node.methods.loadOptions.getSurveys.call(context({ responses: [{ surveys: [null] }] })), /unsupported survey list/);
});
test('question-ID maps preserve raw values independently from labels and duplicate titles', () => {
  const record = responseRecord({ ...fixture, id: 'do_not_use' });
  assert.equal(record.id, fixture.eventId);
  assert.deepEqual(record.response, fixture.response);
  for (const answer of fixture.response.answers) assert.deepEqual(record.answersById[answer.questionId], answer.value);
  assert.deepEqual(record.displayAnswersById.q_multi, ['First option', 'Other']);
});
test('malformed answers are rejected clearly instead of silently dropping data or throwing TypeError', () => {
  for (const answers of [[null], [5], [{ value: 'no ID' }], [{ questionId: 'missing_value' }]]) {
    assert.throws(() => responseRecord({ ...fixture, response: { ...fixture.response, answers } }), /unsupported response payload/);
  }
  const record = responseRecord({ ...fixture, response: { ...fixture.response, answers: [{ questionId: '__proto__', value: 'safe value' }] } });
  assert.equal(Object.getPrototypeOf(record.answersById), Object.prototype);
  assert.equal(Object.hasOwn(record.answersById, '__proto__'), true);
  assert.equal(record.answersById.__proto__, 'safe value');
});
test('webhook emits one typed event and ignores unrelated, sample or wrong-survey events', async () => {
  for (const payload of [fixture, { ...fixture, test: true }, { ...fixture, event: 'connection.test' }, { ...fixture, survey: { id: 'different' } }]) {
    const result = await node.webhook.call({
      getBodyData: () => payload, getNodeParameter: () => fixture.survey.id, getNode: () => workflowNode,
      helpers: { returnJsonArray: records => records.map(json => ({ json })) },
    });
    if (payload === fixture) assert.equal(result.workflowData[0][0].json.id, fixture.eventId);
    else assert.deepEqual(result.workflowData, []);
  }
});
test('matching malformed webhook payload surfaces a node error without exposing response answers', async () => {
  await assert.rejects(node.webhook.call({
    getNode: () => workflowNode, getNodeParameter: () => fixture.survey.id,
    getBodyData: () => ({ ...fixture, response: { ...fixture.response, answers: [null, { value: 'private answer' }] } }),
  }), error => {
    assert.ok(error instanceof NodeOperationError);
    assert.match(error.message, /unsupported response payload/);
    assert.doesNotMatch(JSON.stringify(error), /private answer/);
    return true;
  });
});
