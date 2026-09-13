import type { IDataObject } from 'n8n-workflow';

export function isDataObject(value: unknown): value is IDataObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function responseRecord(payload: IDataObject): IDataObject {
  const response = payload.response;
  if (payload.version !== '1' || typeof payload.eventId !== 'string' || !payload.eventId ||
    !isDataObject(payload.survey) || typeof payload.survey.id !== 'string' || !payload.survey.id ||
    !isDataObject(response) || typeof response.id !== 'string' || !response.id ||
    !Array.isArray(response.answers) || !response.answers.every(answer =>
      isDataObject(answer) && typeof answer.questionId === 'string' && answer.questionId.length > 0 && answer.value !== undefined)) {
    throw new Error('Excellent Survey returned an unsupported response payload.');
  }
  const answers = response.answers as IDataObject[];
  return {
    ...payload,
    id: payload.eventId,
    answersById: Object.fromEntries(answers.map(answer => [String(answer.questionId), answer.value])),
    displayAnswersById: Object.fromEntries(answers.map(answer => [String(answer.questionId), answer.displayValue === undefined ? answer.value : answer.displayValue])),
  };
}
