import type {
  IDataObject, IHookFunctions, ILoadOptionsFunctions, INodeType, INodeTypeDescription,
  INodePropertyOptions, IWebhookFunctions, IWebhookResponseData, IHttpRequestMethods, JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { isDataObject, responseRecord } from './response';

const API = 'https://excellentsurvey.com/api/connect/v1';
type ApiContext = IHookFunctions | ILoadOptionsFunctions;
type Subscription = { id: string; surveyId: string };
type SavedSubscription = Subscription & { url: string };

async function request<T>(context: ApiContext, method: IHttpRequestMethods, path: string, body?: IDataObject): Promise<T> {
  try {
    return await context.helpers.httpRequestWithAuthentication.call(context, 'excellentSurveyOAuth2Api', {
      method, url: `${API}${path}`, json: true, ...(body ? { body } : {}),
    }) as T;
  } catch (error) {
    const apiError = new NodeApiError(context.getNode(), error as JsonObject);
    const guidance: Record<string, string> = {
      '401': 'Reconnect your Excellent Survey account in the selected credential, then try again.',
      '403': 'Reconnect your Excellent Survey account and approve the selected survey and all requested permissions.',
      '404': 'Check that the selected survey still exists and is approved for this connection.',
      '409': 'Your Excellent Survey integration limit has been reached. Remove an unused connection before activating this trigger.',
      '429': 'Wait before trying again. Excellent Survey limits how frequently connections can request data.',
    };
    if (apiError.httpCode && guidance[apiError.httpCode]) {
      apiError.description = guidance[apiError.httpCode];
    }
    throw apiError;
  }
}

function location(context: IHookFunctions) {
  const url = context.getNodeWebhookUrl('default');
  let valid = false;
  try {
    if (url) {
      const parsed = new URL(url);
      valid = parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    }
  } catch { /* The configuration message below also covers malformed URLs. */ }
  if (!valid || !url) {
    throw new NodeOperationError(context.getNode(), 'The webhook URL must use HTTPS', {
      description: 'Configure a public HTTPS webhook base URL in n8n before activating this trigger.',
    });
  }
  // Test and production URLs have separate lifecycle records and cannot remove each other.
  const key = `excellentSurveySubscription_${encodeURIComponent(url)}`;
  return { url, key, store: context.getWorkflowStaticData('node') };
}

function selectedSurveyId(context: IHookFunctions | IWebhookFunctions) {
  const surveyId = context.getNodeParameter('surveyId');
  if (typeof surveyId !== 'string' || !surveyId.trim()) {
    throw new NodeOperationError(context.getNode(), 'A survey must be selected', {
      description: 'Choose a survey in \'Survey Name or ID\' before activating this trigger.',
    });
  }
  return surveyId;
}

export class ExcellentSurveyTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Excellent Survey Trigger', name: 'excellentSurveyTrigger',
    icon: { light: 'file:excellentSurvey.svg', dark: 'file:excellentSurvey.dark.svg' }, group: ['trigger'], version: 1,
    subtitle: '=Survey: {{$parameter["surveyId"]}}',
    description: 'Starts a workflow when a respondent completes your selected survey',
    defaults: { name: 'Excellent Survey Trigger' },
    inputs: [], outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'excellentSurveyOAuth2Api', required: true }],
    webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'response' }],
    properties: [
      {
        displayName: 'Survey Name or ID', name: 'surveyId', type: 'options', default: '', required: true,
        typeOptions: { loadOptionsMethod: 'getSurveys' },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Reconnect your account to approve more surveys. This trigger subscribes automatically and starts only for new completed responses. Answers use stable question IDs; the complete response stays available.',
        name: 'responseNotice', type: 'notice', default: '',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getSurveys(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const result = await request<{ surveys: { id: string; title: string }[] }>(this, 'GET', '/surveys');
        if (!isDataObject(result) || !Array.isArray(result.surveys) || !result.surveys.every(survey =>
          isDataObject(survey) && typeof survey.id === 'string' && survey.id && typeof survey.title === 'string')) {
          throw new NodeOperationError(this.getNode(), 'Excellent Survey returned an unsupported survey list', {
            description: 'Try loading the surveys again. If this continues, contact support@excellentsurvey.com.',
          });
        }
        const { surveys } = result;
        return surveys.map(survey => ({ name: survey.title, value: survey.id })).sort((a, b) => a.name.localeCompare(b.name));
      },
    },
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const { store, key } = location(this);
        const surveyId = selectedSurveyId(this);
        const saved = store[key] as SavedSubscription | undefined;
        if (!saved || saved.surveyId !== surveyId) return false;
        const result = await request<{ subscriptions: Subscription[] }>(this, 'GET', '/subscriptions');
        if (!isDataObject(result) || !Array.isArray(result.subscriptions) || !result.subscriptions.every(subscription =>
          isDataObject(subscription) && typeof subscription.id === 'string' && typeof subscription.surveyId === 'string')) {
          throw new NodeOperationError(this.getNode(), 'Excellent Survey returned an unsupported subscription list', {
            description: 'Try activating the trigger again. If this continues, contact support@excellentsurvey.com.',
          });
        }
        const { subscriptions } = result;
        return subscriptions.some(subscription => subscription.id === saved.id && subscription.surveyId === surveyId);
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const { store, key, url } = location(this);
        const surveyId = selectedSurveyId(this);
        const previous = store[key] as SavedSubscription | undefined;
        if (previous && previous.surveyId !== surveyId) {
          await request(this, 'DELETE', `/subscriptions/${encodeURIComponent(previous.id)}`);
          delete store[key];
        }
        const created = await request<{ id: string }>(this, 'POST', '/subscriptions', { surveyId, url });
        if (!isDataObject(created) || typeof created.id !== 'string' || !created.id) {
          throw new NodeOperationError(this.getNode(), 'Excellent Survey did not confirm the new subscription', {
            description: 'Try activating this trigger again. If this continues, contact support@excellentsurvey.com.',
          });
        }
        store[key] = { id: created.id, surveyId, url };
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        const { store, key } = location(this);
        const saved = store[key] as SavedSubscription | undefined;
        if (saved) {
          await request(this, 'DELETE', `/subscriptions/${encodeURIComponent(saved.id)}`);
          delete store[key];
        }
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const payload = this.getBodyData();
    if (!isDataObject(payload)) return { workflowData: [] };
    const survey = payload.survey as IDataObject | undefined;
    if (payload.event !== 'response.completed' || payload.test !== false || survey?.id !== selectedSurveyId(this)) return { workflowData: [] };
    let record: IDataObject;
    try {
      record = responseRecord(payload);
    } catch {
      throw new NodeOperationError(this.getNode(), 'Excellent Survey sent an unsupported response payload', {
        description: 'Update the Excellent Survey node to the latest version. If this continues, contact support@excellentsurvey.com.',
      });
    }
    return { workflowData: [this.helpers.returnJsonArray([record])] };
  }
}
