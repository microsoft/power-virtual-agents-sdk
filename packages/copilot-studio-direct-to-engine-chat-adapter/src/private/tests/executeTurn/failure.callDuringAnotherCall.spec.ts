import type { Activity } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import type { Strategy } from '../../../types/Strategy';
import DirectToEngineServerSentEventsChatAdapterAPI from '../../DirectToEngineServerSentEventsChatAdapterAPI';
import asyncIterableToArray from '../../asyncIterableToArray';
import type { BotResponse } from '../../types/BotResponse';
import { parseConversationId } from '../../types/ConversationId';
import type { DefaultHttpResponseResolver } from '../../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../../types/JestMockOf';

const server = setupServer();

const NOT_MOCKED: DefaultHttpResponseResolver = () => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['rest' as const, 'server sent events' as const])('Using "%s" transport', transport => {
  let strategy: Strategy;

  beforeEach(() => {
    strategy = {
      async prepareExecuteTurn() {
        return Promise.resolve({
          baseURL: new URL('http://test/?api=execute#2'),
          body: { dummy: 'dummy' },
          headers: new Headers({ 'x-dummy': 'dummy' }),
          transport
        });
      },
      async prepareStartNewConversation() {
        return Promise.resolve({
          baseURL: new URL('http://test/?api=start#1'),
          body: { dummy: 'dummy' },
          headers: new Headers({ 'x-dummy': 'dummy' }),
          transport
        });
      }
    };
  });

  describe.each([true, false])('With emitStartConversationEvent of %s', emitStartConversationEvent => {
    let adapter: DirectToEngineServerSentEventsChatAdapterAPI;
    let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;

    beforeEach(() => {
      httpPostContinue = jest.fn(NOT_MOCKED);
      httpPostConversation = jest.fn(NOT_MOCKED);
      httpPostExecute = jest.fn(NOT_MOCKED);

      server.use(http.post('http://test/conversations', httpPostConversation));
      server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
      server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));

      adapter = new DirectToEngineServerSentEventsChatAdapterAPI(strategy, { retry: { factor: 1, minTimeout: 0 } });
    });

    describe('When conversation started and first turn completed', () => {
      let activities: Activity[];

      beforeEach(async () => {
        if (transport === 'rest') {
          httpPostConversation.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
              conversationId: parseConversationId('c-00001')
            } satisfies BotResponse)
          );
        } else if (transport === 'server sent events') {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );
        }

        const startNewConversationResult = adapter.startNewConversation(emitStartConversationEvent);

        activities = await asyncIterableToArray(startNewConversationResult);
      });

      test('should receive greeting activities', () =>
        expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }]));

      describe('when execute turn', () => {
        let executeTurnResult: ReturnType<DirectToEngineServerSentEventsChatAdapterAPI['executeTurn']>;

        beforeEach(() => {
          executeTurnResult = adapter.executeTurn({ from: { id: 'u-00001' }, text: 'Aloha!', type: 'message' });
        });

        describe('when call executeTurn again', () => {
          let errorThrown: unknown;

          beforeEach(() => {
            try {
              adapter.executeTurn({ from: { id: 'u-00001' }, text: 'Aloha!', type: 'message' });
            } catch (error) {
              errorThrown = error;
            }
          });

          test('should throw', () =>
            expect(() => {
              if (errorThrown) {
                throw errorThrown;
              }
            }).toThrow('Another operation is in progress.'));

          describe('when complete iterating the first call', () => {
            let activities: Activity[];

            beforeEach(async () => {
              if (transport === 'rest') {
                httpPostExecute.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'continue',
                    activities: [{ from: { id: 'bot' }, text: 'Good morning!', type: 'message' }],
                    conversationId: parseConversationId('c-00001')
                  } satisfies BotResponse)
                );

                httpPostContinue.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'waiting',
                    activities: [{ from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }],
                    conversationId: parseConversationId('c-00001')
                  } satisfies BotResponse)
                );
              } else if (transport === 'server sent events') {
                httpPostExecute.mockImplementationOnce(
                  () =>
                    new HttpResponse(
                      Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Good morning!", "type": "message" }

event: activity
data: { "from": { "id": "bot" }, "text": "Goodbye!", "type": "message" }

event: end
data: end

`),
                      { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                    )
                );
              }

              activities = await asyncIterableToArray(executeTurnResult);
            });

            test('should receive all activities', () =>
              expect(activities).toEqual([
                { from: { id: 'bot' }, text: 'Good morning!', type: 'message' },
                { from: { id: 'bot' }, text: 'Goodbye!', type: 'message' }
              ]));
          });
        });
      });
    });
  });
});
