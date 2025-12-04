import React, { ChangeEvent, useRef, useEffect } from 'react';
import { FieldSet, InlineField, Input, Stack, Switch, Tooltip, Icon, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { DataSourcePluginOptionsEditorProps, GrafanaTheme2 } from '@grafana/data';
import { OctoMeshDataSourceOptions, OctoMeshSecureJsonData } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<OctoMeshDataSourceOptions, OctoMeshSecureJsonData> { }

const getStyles = (theme: GrafanaTheme2) => ({
  inlineSwitchLabel: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;
  const { jsonData } = options;
  const styles = useStyles2(getStyles);

  // Track the saved URL to detect unsaved changes
  // When component mounts, options.url reflects what's persisted in backend
  const savedUrlRef = useRef(options.url);

  // Update savedUrlRef when options.version changes (indicates a save occurred)
  useEffect(() => {
    savedUrlRef.current = options.url;
  }, [options.version, options.url]);

  const onUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newUrl = event.target.value;
    onOptionsChange({
      ...options,
      // Set root-level url for Grafana proxy routing
      url: newUrl,
      jsonData: {
        ...jsonData,
        // Reset tenant when URL changes?
        // Maybe better to keep it so user doesn't have to re-type if they just fixed a typo in URL
        // tenantId: undefined, 

        // Forward user's OAuth token to OctoMesh
        oauthPassThru: true,
        // Preserve existing tlsSkipVerify setting (default: false for security)
        tlsSkipVerify: jsonData.tlsSkipVerify ?? false,
      },
    });
  };

  const onTenantIdChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        tenantId: event.target.value,
      },
    });
  };

  const onTlsSkipVerifyChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        tlsSkipVerify: event.target.checked,
      },
    });
  };

  return (
    <>
      <FieldSet label="Connection">
        <InlineField
          label="OctoMesh URL"
          labelWidth={20}
          tooltip="Base URL of the OctoMesh Asset Repository (e.g., https://octomesh.example.com)"
        >
          <Stack gap={2} direction="row" alignItems="center">
            <Input
              id="config-editor-url"
              onChange={onUrlChange}
              value={options.url ?? ''}
              placeholder="https://octomesh.example.com"
              width={60}
            />
            <span className={styles.inlineSwitchLabel}>Skip TLS Verify</span>
            <Switch
              id="config-tls-skip-verify"
              value={jsonData.tlsSkipVerify ?? false}
              onChange={onTlsSkipVerifyChange}
            />
            <Tooltip content="Skip TLS certificate verification. WARNING: Insecure, use only for development/testing.">
              <Icon name="info-circle" style={{ cursor: 'pointer' }} />
            </Tooltip>
          </Stack>
        </InlineField>

        <InlineField
          label="Tenant ID"
          labelWidth={20}
          tooltip="Enter the OctoMesh tenant ID to query"
        >
          <Input
            id="config-editor-tenant"
            value={jsonData.tenantId ?? ''}
            onChange={onTenantIdChange}
            placeholder="e.g. tenant-123"
            width={40}
          />
        </InlineField>
      </FieldSet>
    </>
  );
}
