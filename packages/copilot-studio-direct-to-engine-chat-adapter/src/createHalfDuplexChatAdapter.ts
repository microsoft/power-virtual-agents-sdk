/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import { type Activity } from 'botframework-directlinejs';

import DirectToEngineServerSentEventsChatAdapterAPI, {
  type DirectToEngineServerSentEventsChatAdapterAPIInit
} from './private/DirectToEngineServerSentEventsChatAdapterAPI';
import { type HalfDuplexChatAdapterAPI } from './private/types/HalfDuplexChatAdapterAPI';
import { type HalfDuplexChatAdapterAPIStrategy } from './private/types/HalfDuplexChatAdapterAPIStrategy';

export type ExecuteTurnFunction = (activity: Activity) => Promise<TurnGenerator>;

type Init = DirectToEngineServerSentEventsChatAdapterAPIInit & {
  emitStartConversationEvent?: boolean;
};

export type TurnGenerator = AsyncGenerator<Activity, ExecuteTurnFunction, undefined>;

const createExecuteTurn = (api: HalfDuplexChatAdapterAPI): ExecuteTurnFunction => {
  let obsoleted = false;

  return async (activity: Activity): Promise<TurnGenerator> => {
    if (obsoleted) {
      throw new Error('This executeTurn() function is obsoleted. Please use a new one.');
    }

    obsoleted = true;

    const activities = await api.executeTurn(activity);

    return (async function* () {
      yield* activities;

      return createExecuteTurn(api);
    })();
  };
};

export default function createHalfDuplexChatAdapter(strategy: HalfDuplexChatAdapterAPIStrategy, init: Init = {}) {
  return async (): Promise<TurnGenerator> => {
    const api = new DirectToEngineServerSentEventsChatAdapterAPI(strategy, init);

    const activities = await api.startNewConversation(init?.emitStartConversationEvent ?? true);

    return (async function* (): TurnGenerator {
      yield* activities;

      return createExecuteTurn(api);
    })();
  };
}
