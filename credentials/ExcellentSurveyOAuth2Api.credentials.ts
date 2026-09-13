import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ExcellentSurveyOAuth2Api implements ICredentialType {
  name = 'excellentSurveyOAuth2Api';
  displayName = 'Excellent Survey OAuth2 API';
  extends = ['oAuth2Api'];
  icon = { light: 'file:excellentSurvey.svg', dark: 'file:excellentSurvey.dark.svg' } as const;
  documentationUrl = 'https://www.npmjs.com/package/n8n-nodes-excellent-survey';
  properties: INodeProperties[] = [
    {
      displayName: 'Contact support@excellentsurvey.com with the OAuth Redirect URL shown above to register your n8n instance. Enter the client ID and secret provided by Excellent Survey, then connect your account.',
      name: 'registrationNotice', type: 'notice', default: '',
    },
    { displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'authorizationCode' },
    { displayName: 'Authorization URL', name: 'authUrl', type: 'hidden', default: 'https://excellentsurvey.com/connect/authorize' },
    { displayName: 'Access Token URL', name: 'accessTokenUrl', type: 'hidden', default: 'https://excellentsurvey.com/api/connect/token' },
    { displayName: 'Scope', name: 'scope', type: 'hidden', default: 'surveys:read responses:read subscriptions:write' },
    { displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'body' },
    { displayName: 'Auth URI Query Parameters', name: 'authQueryParameters', type: 'hidden', default: '' },
  ];
}
