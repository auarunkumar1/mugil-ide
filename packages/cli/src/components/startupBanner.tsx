import React from 'react';
import { Box, Text } from 'ink';
import { BRAND, VERSION, type AppConfig } from '@mugil-ide/core';

export interface StartupBannerProps {
  config: AppConfig;
  isLive: boolean;
}

export function StartupBanner({ config, isLive }: StartupBannerProps): React.ReactElement {
  const cacheBackend = config.redisUrl ? 'Redis' : config.cacheDir ? 'Disk' : 'Memory';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          ✦ {BRAND} v{VERSION} — System Initialized
        </Text>
        <Text dimColor>Credits: Built by Mugil Team</Text>
      </Box>

      <Box flexDirection="row" marginTop={1} gap={2}>
        <Box flexDirection="column" width="50%">
          <Text bold color="green">Pipeline Modules:</Text>
          <Text dimColor>✓ Signature Stripper · RTK Compressor</Text>
          <Text dimColor>✓ Caveman Engine · CodeGraph Indexer</Text>
          <Text dimColor>✓ Context Resolver (@file support)</Text>
          <Text dimColor>✓ Smart Cache ({cacheBackend})</Text>
        </Box>
        <Box flexDirection="column" width="50%">
          <Text bold color="yellow">Quick Commands:</Text>
          <Text dimColor>• <Text color="cyan">@&lt;file&gt;</Text> attach file to prompt</Text>
          <Text dimColor>• <Text color="cyan">/model</Text> · <Text color="cyan">/thinking</Text> · <Text color="cyan">/accounts</Text></Text>
          <Text dimColor>• <Text color="cyan">/plan</Text> | <Text color="cyan">/act</Text> · <Text color="cyan">/clear-cache</Text></Text>
          <Text color={isLive ? 'green' : 'yellow'}>
            {isLive ? '✓ ' : '⚡ '}AI: {config.provider.toUpperCase()} [{isLive ? 'LIVE' : 'OFFLINE MOCK'}]
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
