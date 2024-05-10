import type { Activity } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction,
  type TurnGenerator
} from '../createHalfDuplexChatAdapter';
// TODO: Fix the import location.
import type { BotResponse } from '../private/types/BotResponse';
import type { HalfDuplexChatAdapterAPIStrategy } from '../private/types/HalfDuplexChatAdapterAPIStrategy';
import type { DefaultHttpResponseResolver } from '../private/tests/types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../private/tests/types/JestMockOf';

const server = setupServer();

const NOT_MOCKED: DefaultHttpResponseResolver = () => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['rest' as const, 'server sent events' as const])('Using "%s" transport', transport => {
  let strategy: HalfDuplexChatAdapterAPIStrategy;

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
    let generator: TurnGenerator;
    let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;

    beforeEach(async () => {
      httpPostContinue = jest.fn(NOT_MOCKED);
      httpPostConversation = jest.fn(NOT_MOCKED);
      httpPostExecute = jest.fn(NOT_MOCKED);

      server.use(http.post('http://test/conversations', httpPostConversation));
      server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
      server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));

      generator = await createHalfDuplexChatAdapter(strategy, {
        emitStartConversationEvent,
        retry: { factor: 1, minTimeout: 0 }
      })();
    });

    describe('When conversation started and bot returned with 3 activities in 3 turns', () => {
      test('should not POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(0));

      describe('after iterate once', () => {
        let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

        beforeEach(async () => {
          if (transport === 'rest') {
            httpPostConversation.mockImplementationOnce(() =>
              HttpResponse.json({
                action: 'continue',
                activities: [{ text: 'Hello, World!', type: 'message' }],
                conversationId: 'c-00001'
              } as BotResponse)
            );
          } else if (transport === 'server sent events') {
            httpPostConversation.mockImplementationOnce(
              () =>
                new HttpResponse(
                  Buffer.from(`event: activity
data: { "text": "Hello, World!", "type": "message" }

event: activity
data: { "text": "Aloha!", "type": "message" }

event: activity
data: { "text": "您好！", "type": "message" }

event: end
data: end

`),
                  { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                )
            );
          }

          iteratorResult = await generator.next();
        });

        describe('should have POST to /conversations', () => {
          test('once', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));

          test('with query "api" of "start"', () =>
            expect(new URL(httpPostConversation.mock.calls[0][0].request.url)).toHaveProperty('search', '?api=start'));

          test('with hash of "#1"', () =>
            expect(new URL(httpPostConversation.mock.calls[0][0].request.url)).toHaveProperty('hash', '#1'));

          if (transport === 'server sent events') {
            test('with header "Accept" of "text/event-stream"', () =>
              expect(httpPostConversation.mock.calls[0][0].request.headers.get('accept')).toBe('text/event-stream'));
          }

          test('with header "Content-Type" of "application/json"', () =>
            expect(httpPostConversation.mock.calls[0][0].request.headers.get('content-type')).toBe('application/json'));

          test('with header "x-dummy" of "dummy"', () =>
            expect(httpPostConversation.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

          test('without header "x-ms-conversationid"', () =>
            expect(httpPostConversation.mock.calls[0][0].request.headers.has('x-ms-conversationid')).toBe(false));

          test(`with JSON body of { dummy: "dummy", emitStartConversationEvent: ${emitStartConversationEvent} }`, () =>
            expect(httpPostConversation.mock.calls[0][0].request.json()).resolves.toEqual({
              dummy: 'dummy',
              emitStartConversationEvent
            }));
        });

        test('should return the first activity', () =>
          expect(iteratorResult).toEqual({
            done: false,
            value: { text: 'Hello, World!', type: 'message' }
          }));

        describe('after iterate twice', () => {
          let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

          beforeEach(async () => {
            if (transport === 'rest') {
              httpPostContinue.mockImplementationOnce(() =>
                HttpResponse.json({
                  action: 'continue',
                  activities: [{ text: 'Aloha!', type: 'message' }]
                } as BotResponse)
              );
            }

            iteratorResult = await generator.next();
          });

          if (transport === 'rest') {
            describe('should have POST to /conversations/c-00001/continue', () => {
              test('once', () => expect(httpPostContinue).toHaveBeenCalledTimes(1));

              test('with query "api" of "start"', () =>
                expect(new URL(httpPostContinue.mock.calls[0][0].request.url)).toHaveProperty('search', '?api=start'));

              test('with hash of "#1"', () =>
                expect(new URL(httpPostContinue.mock.calls[0][0].request.url)).toHaveProperty('hash', '#1'));

              test('with header "Content-Type" of "application/json"', () =>
                expect(httpPostContinue.mock.calls[0][0].request.headers.get('content-type')).toBe('application/json'));

              test('with header "x-dummy" of "dummy"', () =>
                expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

              test('with header "x-ms-conversationid" of "c-00001"', () =>
                expect(httpPostContinue.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe('c-00001'));

              test('with JSON body of { dummy: "dummy" }', () =>
                expect(httpPostContinue.mock.calls[0][0].request.json()).resolves.toEqual({
                  dummy: 'dummy'
                }));
            });
          }

          test('should return the second activity', () =>
            expect(iteratorResult).toEqual({
              done: false,
              value: { text: 'Aloha!', type: 'message' }
            }));

          describe('after iterate the third time', () => {
            let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

            beforeEach(async () => {
              if (transport === 'rest') {
                httpPostContinue.mockImplementationOnce(() =>
                  HttpResponse.json({
                    action: 'waiting',
                    activities: [{ text: '您好！', type: 'message' }]
                  } as BotResponse)
                );
              }

              iteratorResult = await generator.next();
            });

            if (transport === 'rest') {
              describe('should have POST to /conversations/c-00001/continue', () => {
                test('once', () => expect(httpPostContinue).toHaveBeenCalledTimes(2));

                test('with query "api" of "start"', () =>
                  expect(new URL(httpPostContinue.mock.calls[1][0].request.url)).toHaveProperty(
                    'search',
                    '?api=start'
                  ));

                test('with hash of "#1"', () =>
                  expect(new URL(httpPostContinue.mock.calls[1][0].request.url)).toHaveProperty('hash', '#1'));

                test('with header "Content-Type" of "application/json"', () =>
                  expect(httpPostContinue.mock.calls[1][0].request.headers.get('content-type')).toBe(
                    'application/json'
                  ));

                test('with header "x-dummy" of "dummy"', () =>
                  expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-dummy')).toBe('dummy'));

                test('with header "x-ms-conversationid" of "c-00001"', () =>
                  expect(httpPostContinue.mock.calls[1][0].request.headers.get('x-ms-conversationid')).toBe('c-00001'));

                test('with JSON body of { dummy: "dummy" }', () =>
                  expect(httpPostContinue.mock.calls[1][0].request.json()).resolves.toEqual({
                    dummy: 'dummy'
                  }));
              });
            }

            test('should return the third activity', () =>
              expect(iteratorResult).toEqual({
                done: false,
                value: { text: '您好！', type: 'message' }
              }));

            describe('after iterate the fourth time', () => {
              let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

              beforeEach(async () => {
                iteratorResult = await generator.next();
              });

              test('should complete and return the next execute function', () =>
                expect(iteratorResult).toEqual({ done: true, value: expect.any(Function) }));

              describe('when execute turn and bot returned 3 activities in 3 turns', () => {
                let generator: TurnGenerator;

                beforeEach(async () => {
                  generator = await (iteratorResult.value as ExecuteTurnFunction)({
                    from: { id: 'u-00001' },
                    text: 'Morning.',
                    type: 'message'
                  });
                });

                test('should not POST to /conversations/c-00001', () =>
                  expect(httpPostExecute).toHaveBeenCalledTimes(0));

                describe('after iterate once', () => {
                  let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                  beforeEach(async () => {
                    if (transport === 'rest') {
                      httpPostExecute.mockImplementationOnce(() =>
                        HttpResponse.json({
                          action: 'continue',
                          activities: [{ text: 'Good morning!', type: 'message' }]
                        } as BotResponse)
                      );
                    } else if (transport === 'server sent events') {
                      httpPostExecute.mockImplementationOnce(
                        () =>
                          new HttpResponse(
                            Buffer.from(`event: activity
data: { "text": "Good morning!", "type": "message" }

event: activity
data: { "text": "Goodbye!", "type": "message" }

event: activity
data: { "text": "再見！", "type": "message" }

event: end
data: end

`),
                            { headers: { 'content-type': 'text/event-stream' } }
                          )
                      );
                    }

                    iteratorResult = await generator.next();
                  });

                  describe('should have POST to /conversations/c-00001', () => {
                    test('once', () => expect(httpPostExecute).toHaveBeenCalledTimes(1));

                    test('with query "api" of "execute"', () =>
                      expect(new URL(httpPostExecute.mock.calls[0][0].request.url)).toHaveProperty(
                        'search',
                        '?api=execute'
                      ));

                    test('with hash of "#2"', () =>
                      expect(new URL(httpPostExecute.mock.calls[0][0].request.url)).toHaveProperty('hash', '#2'));

                    if (transport === 'server sent events') {
                      test('with header "Accept" of "text/event-stream"', () =>
                        expect(httpPostExecute.mock.calls[0][0].request.headers.get('accept')).toBe(
                          'text/event-stream'
                        ));
                    }

                    test('with header "Content-Type" of "application/json"', () =>
                      expect(httpPostExecute.mock.calls[0][0].request.headers.get('content-type')).toBe(
                        'application/json'
                      ));

                    test('with header "x-dummy" of "dummy"', () =>
                      expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-dummy')).toBe('dummy'));

                    test('with header "x-ms-conversationid" of "c-00001"', () =>
                      expect(httpPostExecute.mock.calls[0][0].request.headers.get('x-ms-conversationid')).toBe(
                        'c-00001'
                      ));

                    test('with JSON body of activity and { dummy: "dummy" }', () =>
                      expect(httpPostExecute.mock.calls[0][0].request.json()).resolves.toEqual({
                        activity: { from: { id: 'u-00001' }, text: 'Morning.', type: 'message' },
                        dummy: 'dummy'
                      }));
                  });

                  test('should return the third activity', () =>
                    expect(iteratorResult).toEqual({
                      done: false,
                      value: { text: 'Good morning!', type: 'message' }
                    }));

                  describe('after iterate twice', () => {
                    let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                    beforeEach(async () => {
                      if (transport === 'rest') {
                        httpPostContinue.mockImplementationOnce(() =>
                          HttpResponse.json({
                            action: 'continue',
                            activities: [{ text: 'Goodbye!', type: 'message' }]
                          } as BotResponse)
                        );
                      }

                      iteratorResult = await generator.next();
                    });

                    if (transport === 'rest') {
                      describe('should have POST to /conversations/c-00001/continue', () => {
                        test('twice', () => expect(httpPostContinue).toHaveBeenCalledTimes(3));

                        test('with query "api" of "execute"', () =>
                          expect(new URL(httpPostContinue.mock.calls[2][0].request.url)).toHaveProperty(
                            'search',
                            '?api=execute'
                          ));

                        test('with hash of "#2"', () =>
                          expect(new URL(httpPostContinue.mock.calls[2][0].request.url)).toHaveProperty('hash', '#2'));

                        test('with header "Content-Type" of "application/json"', () =>
                          expect(httpPostContinue.mock.calls[2][0].request.headers.get('content-type')).toBe(
                            'application/json'
                          ));

                        test('with header "x-dummy" of "dummy"', () =>
                          expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-dummy')).toBe('dummy'));

                        test('with header "x-ms-conversationid" of "c-00001"', () =>
                          expect(httpPostContinue.mock.calls[2][0].request.headers.get('x-ms-conversationid')).toBe(
                            'c-00001'
                          ));

                        test('with JSON body of { dummy: "dummy" }', () =>
                          expect(httpPostContinue.mock.calls[2][0].request.json()).resolves.toEqual({
                            dummy: 'dummy'
                          }));
                      });
                    }

                    test('should return the fifth activity', () =>
                      expect(iteratorResult).toEqual({
                        done: false,
                        value: { text: 'Goodbye!', type: 'message' }
                      }));

                    describe('after iterate the third time', () => {
                      let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                      beforeEach(async () => {
                        if (transport === 'rest') {
                          httpPostContinue.mockImplementationOnce(() =>
                            HttpResponse.json({
                              action: 'waiting',
                              activities: [{ text: '再見！', type: 'message' }]
                            } as BotResponse)
                          );
                        }

                        iteratorResult = await generator.next();
                      });

                      if (transport === 'rest') {
                        describe('should have POST to /conversations/c-00001/continue', () => {
                          test('twice', () => expect(httpPostContinue).toHaveBeenCalledTimes(4));

                          test('with query "api" of "execute"', () =>
                            expect(new URL(httpPostContinue.mock.calls[3][0].request.url)).toHaveProperty(
                              'search',
                              '?api=execute'
                            ));

                          test('with hash of "#2"', () =>
                            expect(new URL(httpPostContinue.mock.calls[3][0].request.url)).toHaveProperty(
                              'hash',
                              '#2'
                            ));

                          test('with header "Content-Type" of "application/json"', () =>
                            expect(httpPostContinue.mock.calls[3][0].request.headers.get('content-type')).toBe(
                              'application/json'
                            ));

                          test('with header "x-dummy" of "dummy"', () =>
                            expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-dummy')).toBe('dummy'));

                          test('with header "x-ms-conversationid" of "c-00001"', () =>
                            expect(httpPostContinue.mock.calls[3][0].request.headers.get('x-ms-conversationid')).toBe(
                              'c-00001'
                            ));

                          test('with JSON body of { dummy: "dummy" }', () =>
                            expect(httpPostContinue.mock.calls[3][0].request.json()).resolves.toEqual({
                              dummy: 'dummy'
                            }));
                        });
                      }

                      test('should return the sixth activity', () =>
                        expect(iteratorResult).toEqual({
                          done: false,
                          value: { text: '再見！', type: 'message' }
                        }));

                      describe('after iterate the fourth time', () => {
                        let iteratorResult: IteratorResult<Activity, ExecuteTurnFunction>;

                        beforeEach(async () => {
                          iteratorResult = await generator.next();
                        });

                        test('should complete', () =>
                          expect(iteratorResult).toEqual({ done: true, value: expect.any(Function) }));
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
