@secure()
param provisionParameters object
param configAdminUPNList string
param configAppClientId string
param configAppTenantId string
param qnaMakerSku string
module provision './provision.bicep' = {
  name: 'provisionResources'
  params: {
    provisionParameters: provisionParameters
    configAdminUPNList: configAdminUPNList
    configAppClientId: configAppClientId
    configAppTenantId: configAppTenantId
    qnaMakerSku: qnaMakerSku
  }
}

module teamsFxConfig './config.bicep' = {
  name: 'addTeamsFxConfigurations'
  params: {
    provisionParameters: provisionParameters
    provisionOutputs: provision
  }
}

output provisionOutput object = provision
output teamsFxConfigurationOutput object = contains(reference(resourceId('Microsoft.Resources/deployments', teamsFxConfig.name), '2020-06-01'), 'outputs') ? teamsFxConfig : {}
