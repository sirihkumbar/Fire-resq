'use client';

import React from 'react';
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  split,
} from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import type { DocumentNode } from 'graphql';
import { getMainDefinition } from '@apollo/client/utilities';

function getGatewayUrls() {
  const defaultHttp = 'https://managing-hosts-framed-sullivan.trycloudflare.com/graphql';
  const defaultWs = 'wss://managing-hosts-framed-sullivan.trycloudflare.com/graphql';

  return {
    httpUrl: process.env.NEXT_PUBLIC_GATEWAY_URL || defaultHttp,
    wsUrl: process.env.NEXT_PUBLIC_GATEWAY_WS_URL || defaultWs,
  };
}

function makeClient() {
  const { httpUrl, wsUrl } = getGatewayUrls();

  const httpLink = new HttpLink({
    uri: httpUrl,
  });

  let wsLink: GraphQLWsLink | null = null;

  if (typeof window !== 'undefined') {
    try {
      wsLink = new GraphQLWsLink(
        createClient({
          url: wsUrl,
        })
      );
    } catch (error) {
      console.warn('GraphQL WebSocket link unavailable:', error);
    }
  }

  const splitLink =
    typeof window !== 'undefined' && wsLink != null
      ? split(
          ({ query }: { query: DocumentNode }) => {
            const definition = getMainDefinition(query);
            return (
              definition.kind === 'OperationDefinition' &&
              definition.operation === 'subscription'
            );
          },
          wsLink,
          httpLink
        )
      : httpLink;

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            teams: {
              merge(existing, incoming) {
                return incoming;
              },
            },
          },
        },
      },
    }),
  });
}

export function ApolloWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => makeClient());
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}