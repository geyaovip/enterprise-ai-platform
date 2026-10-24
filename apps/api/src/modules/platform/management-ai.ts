/** Reserved server scopes; never installed or granted as business applications. */
export const isManagementAi = (appId: string) => appId === 'tenant_admin' || appId === 'platform_admin';
