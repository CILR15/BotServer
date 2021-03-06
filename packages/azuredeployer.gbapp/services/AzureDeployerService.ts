/*****************************************************************************\
|                                               ( )_  _                       |
|    _ _    _ __   _ _    __    ___ ___     _ _ | ,_)(_)  ___   ___     _     |
|   ( '_`\ ( '__)/'_` ) /'_ `\/' _ ` _ `\ /'_` )| |  | |/',__)/' _ `\ /'_`\   |
|   | (_) )| |  ( (_| |( (_) || ( ) ( ) |( (_| || |_ | |\__, \| ( ) |( (_) )  |
|   | ,__/'(_)  `\__,_)`\__  |(_) (_) (_)`\__,_)`\__)(_)(____/(_) (_)`\___/'  |
|   | |                ( )_) |                                                |
|   (_)                 \___/'                                                |
|                                                                             |
| General Bots Copyright (c) Pragmatismo.io. All rights reserved.             |
| Licensed under the AGPL-3.0.                                                |
|                                                                             |
| According to our dual licensing model, this program can be used either      |
| under the terms of the GNU Affero General Public License, version 3,        |
| or under a proprietary license.                                             |
|                                                                             |
| The texts of the GNU Affero General Public License with an additional       |
| permission and of our proprietary license can be found at and               |
| in the LICENSE file you have received along with this program.              |
|                                                                             |
| This program is distributed in the hope that it will be useful,             |
| but WITHOUT ANY WARRANTY, without even the implied warranty of              |
| MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                |
| GNU Affero General Public License for more details.                         |
|                                                                             |
| "General Bots" is a registered trademark of Pragmatismo.io.                 |
| The licensing of the program under the AGPLv3 does not imply a              |
| trademark license. Therefore any rights, title and interest in              |
| our trademarks remain entirely with us.                                     |
|                                                                             |
\*****************************************************************************/

/**
 * @fileoverview General Bots server core.
 */

'use strict';

import { CognitiveServicesManagementClient } from 'azure-arm-cognitiveservices';
import { CognitiveServicesAccount } from 'azure-arm-cognitiveservices/lib/models';
import {
  ResourceManagementClient,
  SubscriptionClient
} from 'azure-arm-resource';
import { SearchManagementClient } from 'azure-arm-search';
import { SqlManagementClient } from 'azure-arm-sql';
import { WebSiteManagementClient } from 'azure-arm-website';
import { AppServicePlan } from 'azure-arm-website/lib/models';
import { GBService, IGBInstance } from 'botlib';
import { HttpMethods, ServiceClient, WebResource } from 'ms-rest-js';
import { GBDeployer } from 'packages/core.gbapp/services/GBDeployer';
import * as simplegit from 'simple-git/promise';
import { GBAdminService } from '../../../packages/admin.gbapp/services/GBAdminService';
import { GBCorePackage } from '../../../packages/core.gbapp';
import { GBConfigService } from '../../../packages/core.gbapp/services/GBConfigService';

const Spinner = require('cli-spinner').Spinner;
const scanf = require('scanf');
const git = simplegit();
const logger = require('../../../src/logger');
const UrlJoin = require('url-join');
const iconUrl =
  'https://github.com/pragmatismo-io/BotServer/blob/master/docs/images/generalbots-logo-squared.png';
const publicIp = require('public-ip');

export class AzureDeployerService extends GBService {
  public static apiVersion = '2017-12-01';
  public instance: IGBInstance;
  public resourceClient: ResourceManagementClient.ResourceManagementClient;
  public webSiteClient: WebSiteManagementClient;
  public storageClient: SqlManagementClient;
  public cognitiveClient: CognitiveServicesManagementClient;
  public searchClient: SearchManagementClient;
  public provider = 'Microsoft.BotService';
  public subscriptionClient: SubscriptionClient.SubscriptionClient;
  public accessToken: string;
  public location: string;
  public subscriptionId: string;
  public farmName: any;
  public deployer: GBDeployer;

  constructor(deployer: GBDeployer) {
    super();
    this.deployer = deployer;
  }
  public static async getSubscriptions(credentials) {
    const subscriptionClient = new SubscriptionClient.default(credentials);
    return subscriptionClient.subscriptions.list();
  }

  public static getKBSearchSchema(indexName) {
    return {
      name: indexName,
      fields: [
        {
          name: 'questionId',
          type: 'Edm.String',
          searchable: false,
          filterable: false,
          retrievable: true,
          sortable: false,
          facetable: false,
          key: true
        },
        {
          name: 'subject1',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          retrievable: false,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'subject2',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          retrievable: false,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'subject3',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          retrievable: false,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'subject4',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          retrievable: false,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'content',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          retrievable: false,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'answerId',
          type: 'Edm.Int32',
          searchable: false,
          filterable: false,
          retrievable: true,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'instanceId',
          type: 'Edm.Int32',
          searchable: false,
          filterable: true,
          retrievable: true,
          sortable: false,
          facetable: false,
          key: false
        },
        {
          name: 'packageId',
          type: 'Edm.Int32',
          searchable: false,
          filterable: true,
          retrievable: true,
          sortable: false,
          facetable: false,
          key: false
        }
      ],
      scoringProfiles: [],
      defaultScoringProfile: null,
      corsOptions: null
    };
  }

  public async deployFarm(proxyAddress: string): Promise<IGBInstance> {
    const culture = 'en-us';

    // Tries do get information from .env file otherwise asks in command-line.

    let instance: IGBInstance = {};
    instance = await this.ensureConfiguration(instance);
    instance.marketplacePassword = GBAdminService.getRndPassword();

    const spinner = new Spinner('%s');
    spinner.start();
    spinner.setSpinnerString('|/-\\');

    let keys: any;
    const name = instance.botId;

    logger.info(`Deploying Deploy Group (It may take a few minutes)...`);
    await this.createDeployGroup(name, instance.cloudLocation);

    logger.info(`Deploying Bot Server...`);
    const serverFarm = await this.createHostingPlan(
      name,
      `${name}-server-plan`,
      instance.cloudLocation
    );
    await this.createServer(
      serverFarm.id,
      name,
      `${name}-server`,
      instance.cloudLocation
    );

    logger.info(`Deploying Bot Storage...`);
    const administratorLogin = `sa${GBAdminService.getRndReadableIdentifier()}`;
    const administratorPassword = GBAdminService.getRndPassword();
    const storageServer = `${name.toLowerCase()}-storage-server`;
    const storageName = `${name}-storage`;
    await this.createStorageServer(
      name,
      storageServer,
      administratorLogin,
      administratorPassword,
      storageServer,
      instance.cloudLocation
    );
    await this.createStorage(
      name,
      storageServer,
      storageName,
      instance.cloudLocation
    );
    instance.storageUsername = administratorLogin;
    instance.storagePassword = administratorPassword;
    instance.storageName = storageName;
    instance.storageDialect = 'mssql';
    instance.storageServer = storageServer;

    logger.info(`Deploying Search...`);
    const searchName = `${name}-search`.toLowerCase();
    await this.createSearch(name, searchName, instance.cloudLocation);
    const searchKeys = await this.searchClient.adminKeys.get(
      name,
      searchName
    );
    instance.searchHost = `${searchName}.search.windows.net`;
    instance.searchIndex = 'azuresql-index';
    instance.searchIndexer = 'azuresql-indexer';
    instance.searchKey = searchKeys.primaryKey;
    this.deployer.rebuildIndex(instance);

    logger.info(`Deploying Speech...`);
    const speech = await this.createSpeech(
      name,
      `${name}-speech`,
      instance.cloudLocation
    );
    keys = await this.cognitiveClient.accounts.listKeys(name, speech.name);
    instance.speechKeyEndpoint = speech.endpoint;
    instance.speechKey = keys.key1;

    logger.info(`Deploying SpellChecker...`);
    const spellChecker = await this.createSpellChecker(
      name,
      `${name}-spellchecker`,
      instance.cloudLocation
    );
    keys = await this.cognitiveClient.accounts.listKeys(
      name,
      spellChecker.name
    );
    instance.spellCheckerKey = keys.key1;
    instance.spellCheckerEndpoint = spellChecker.endpoint;

    logger.info(`Deploying Text Analytics...`);
    const textAnalytics = await this.createTextAnalytics(
      name,
      `${name}-textanalytics`,
      instance.cloudLocation
    );
    keys = await this.cognitiveClient.accounts.listKeys(
      name,
      textAnalytics.name
    );
    instance.textAnalyticsEndpoint = textAnalytics.endpoint;
    instance.textAnalyticsKey = keys.key1;

    logger.info(`Deploying NLP...`);
    const nlp = await this.createNLP(name, `${name}-nlp`, instance.cloudLocation);
    keys = await this.cognitiveClient.accounts.listKeys(name, nlp.name);
    const nlpAppId = await this.createLUISApp(
      name,
      name,
      instance.cloudLocation,
      culture,
      instance.nlpAuthoringKey
    );

    instance.nlpEndpoint = nlp.endpoint;
    instance.nlpKey = keys.key1;
    instance.nlpAppId = nlpAppId;

    logger.info(`Deploying Bot...`);

    // TODO: Default endpoint, will be updated when it runs in production.
    
    instance.botEndpoint = 'http://localhost:4242';

    instance = await this.deployBootBot(
      instance,
      name,
      `${proxyAddress}/api/messages/${name}`,
      instance.nlpAppId,
      instance.nlpKey,
      instance.cloudSubscriptionId
    );

    spinner.stop();
    return instance;
  }

  public async openStorageFirewall(groupName, serverName) {
    const username = GBConfigService.get('CLOUD_USERNAME');
    const password = GBConfigService.get('CLOUD_PASSWORD');
    const subscriptionId = GBConfigService.get('CLOUD_SUBSCRIPTIONID');

    const credentials = await GBAdminService.getADALCredentialsFromUsername(
      username,
      password
    );
    const storageClient = new SqlManagementClient(credentials, subscriptionId);

    const ip = await publicIp.v4();
    const params = {
      startIpAddress: ip,
      endIpAddress: ip
    };

    await storageClient.firewallRules.createOrUpdate(
      groupName,
      serverName,
      'gb',
      params
    );
  }

  public async deployBootBot(
    instance,
    botId,
    endpoint,
    nlpAppId,
    nlpKey,
    subscriptionId
  ) {
    let appId = GBConfigService.get('MARKETPLACE_ID');
    let appPassword = GBConfigService.get('MARKETPLACE_SECRET');

    if (!appId || !appPassword) {
      process.stdout.write(
        'Sorry, this part cannot be automated yet due to Microsoft schedule, please go to https://apps.dev.microsoft.com/portal/register-app to generate manually an App ID and App Secret.\n'
      );
    }

    const retriveAppId = () => {
      if (!appId) {
        process.stdout.write('Generated Application Id (MARKETPLACE_ID):');
        appId = scanf('%s').replace(/(\n|\r)+$/, '');
      }
    };

    const retriveAppPassword = () => {
      if (!appPassword) {
        process.stdout.write('Generated Password (MARKETPLACE_SECRET):');
        appPassword = scanf('%s').replace(/(\n|\r)+$/, '');
      }
    };

    retriveAppId();
    retriveAppPassword();

    await this.internalDeployBot(
      instance,
      this.accessToken,
      botId,
      botId,
      botId,
      'General BootBot',
      endpoint,
      'global',
      nlpAppId,
      nlpKey,
      appId,
      appPassword,
      subscriptionId
    );
    instance.marketplaceId = appId;
    instance.marketplacePassword = appPassword;
    instance.botId = botId;

    return instance;
  }

  public async updateBotProxy(botId, group, endpoint) {
    const baseUrl = `https://management.azure.com/`;
    const username = GBConfigService.get('CLOUD_USERNAME');
    const password = GBConfigService.get('CLOUD_PASSWORD');
    const subscriptionId = GBConfigService.get('CLOUD_SUBSCRIPTIONID');

    const accessToken = await GBAdminService.getADALTokenFromUsername(
      username,
      password
    );
    const httpClient = new ServiceClient();

    const parameters = {
      properties: {
        endpoint: endpoint
      }
    };

    const query = `subscriptions/${subscriptionId}/resourceGroups/${group}/providers/${
      this.provider
    }/botServices/${botId}?api-version=${AzureDeployerService.apiVersion}`;
    const url = UrlJoin(baseUrl, query);
    const req = this.createRequestObject(
      url,
      accessToken,
      'PATCH',
      JSON.stringify(parameters)
    );
    const res = await httpClient.sendRequest(req);
    if (!(res.bodyAsJson as any).id) {
      throw res.bodyAsText;
    }
    logger.info(`Bot proxy updated at: ${endpoint}.`);
  }

  public async deployGeneralBotsToAzure() {
    const status = await git.status();
    // TODO: Copy github to webapp.
  }

  private async ensureConfiguration(instance: IGBInstance) {
    let username = GBConfigService.get('CLOUD_USERNAME');
    let password = GBConfigService.get('CLOUD_PASSWORD');
    let subscriptionId = GBConfigService.get('CLOUD_SUBSCRIPTIONID');
    let location = GBConfigService.get('CLOUD_LOCATION');
    let botId = GBConfigService.get('BOT_ID');

    // No .env so asks for cloud credentials to start a new farm.
    if (!username || !password || !subscriptionId || !location || !botId) {
      process.stdout.write(
        'A empty enviroment is detected. To start automatic deploy, please enter some information:\n'
      );
    }
    const retriveUsername = () => {
      if (!username) {
        process.stdout.write(`${GBAdminService.GB_PROMPT}CLOUD_USERNAME:`);
        username = scanf('%s').replace(/(\n|\r)+$/, '');
      }
    };
    const retrivePassword = () => {
      if (!password) {
        process.stdout.write(`${GBAdminService.GB_PROMPT}CLOUD_PASSWORD:`);
        password = scanf('%s').replace(/(\n|\r)+$/, '');
      }
    };
    const retrieveBotId = () => {
      if (!botId) {
        process.stdout.write(
          `${GBAdminService.GB_PROMPT}Choose a unique bot Id containing lowercase letters, digits or dashes (cannot use dash as the first two or last one characters), cannot start or end with or contain consecutive dashes and having 4 to 42 characters long.\n`
        );
        process.stdout.write(`${GBAdminService.GB_PROMPT}BOT_ID:`);
        botId = scanf('%s').replace(/(\n|\r)+$/, ''); // TODO: Update this regexp to match description of it.
      }
    };
    let authoringKey = GBConfigService.get('NLP_AUTHORING_KEY');
    const retriveAuthoringKey = () => {
      if (!authoringKey) {
        process.stdout.write(
          `${GBAdminService.GB_PROMPT}Due to this opened issue: https://github.com/Microsoft/botbuilder-tools/issues/550\n`
        );
        process.stdout.write(`${GBAdminService.GB_PROMPT}Please enter your LUIS Authoring Key:`); // TODO: INCLUDE URL
        authoringKey = scanf('%s').replace(/(\n|\r)+$/, '');
      }
    };
    while (!authoringKey) {
      retriveAuthoringKey();
    }
    while (!botId) {
      retrieveBotId();
    }
    while (!username) {
      retriveUsername();
    }
    while (!password) {
      retrivePassword();
    }

    // Connects to the cloud and retrives subscriptions.

    const credentials = await GBAdminService.getADALCredentialsFromUsername(
      username,
      password
    );
    if (!subscriptionId) {
      const map = {};
      let index = 1;
      const list = await AzureDeployerService.getSubscriptions(credentials);
      list.forEach(element => {
        console.log(
          `${index}: ${element.displayName} (${element.subscriptionId})`
        );
        map[index++] = element;
      });
      let subscriptionIndex;
      const retrieveSubscription = () => {
        if (!subscriptionIndex) {
          process.stdout.write('CLOUD_SUBSCRIPTIONID (type a number):');
          subscriptionIndex = scanf('%d');
        }
      };
      while (!subscriptionIndex) {
        retrieveSubscription();
      }
      subscriptionId = map[subscriptionIndex].subscriptionId;
    }
    const retriveLocation = () => {
      if (!location) {
        process.stdout.write('CLOUD_LOCATION (eg. \'westus\'):');
        location = scanf('%s');
      }
    };
    while (!location) {
      retriveLocation();
    }

    // Prepares the first instance on bot farm.

    instance.botId = botId;
    instance.cloudUsername = username;
    instance.cloudPassword = password;
    instance.cloudSubscriptionId = subscriptionId;
    instance.cloudLocation = location;
    instance.nlpAuthoringKey = authoringKey;
    instance.adminPass = GBAdminService.getRndPassword();

    this.resourceClient = new ResourceManagementClient.default(
      credentials,
      subscriptionId
    );
    this.webSiteClient = new WebSiteManagementClient(
      credentials,
      subscriptionId
    );
    this.storageClient = new SqlManagementClient(credentials, subscriptionId);
    this.cognitiveClient = new CognitiveServicesManagementClient(
      credentials,
      subscriptionId
    );

    this.searchClient = new SearchManagementClient(credentials, subscriptionId);
    this.accessToken = credentials.tokenCache._entries[0].accessToken;

    return instance;
  }

  private async createStorageServer(
    group,
    name,
    administratorLogin,
    administratorPassword,
    serverName,
    location
  ) {
    const params = {
      location: location,
      administratorLogin: administratorLogin,
      administratorLoginPassword: administratorPassword,
      fullyQualifiedDomainName: `${serverName}.database.windows.net`
    };

    return this.storageClient.servers.createOrUpdate(group, name, params);
  }

  private async registerProviders(subscriptionId, baseUrl, accessToken) {
    const query = `subscriptions/${subscriptionId}/providers/${
      this.provider
    }/register?api-version=2018-02-01`;
    const requestUrl = UrlJoin(baseUrl, query);

    const req = new WebResource();
    req.method = 'POST';
    req.url = requestUrl;
    req.headers = {};
    req.headers['Content-Type'] = 'application/json; charset=utf-8';
    req.headers['accept-language'] = '*';
    req.headers.Authorization = 'Bearer ' + accessToken;

    const httpClient = new ServiceClient();
    const res = await httpClient.sendRequest(req);
    // TODO: Check res for error.
  }
  /**
   * @see https://github.com/Azure/azure-rest-api-specs/blob/master/specification/botservice/resource-manager/Microsoft.BotService/preview/2017-12-01/botservice.json
   */
  private async internalDeployBot(
    instance,
    accessToken,
    botId,
    name,
    group,
    description,
    endpoint,
    location,
    nlpAppId,
    nlpKey,
    appId,
    appPassword,
    subscriptionId
  ) {
    return new Promise(async (resolve, reject) => {
      const baseUrl = `https://management.azure.com/`;
      await this.registerProviders(subscriptionId, baseUrl, accessToken);

      instance.marketplaceId = appId;
      instance.marketplacePassword = appPassword;
      instance.engineName = GBCorePackage.CurrentEngineName;

      const parameters = {
        location: location,
        sku: {
          name: 'F0'
        },
        name: botId,
        kind: 'bot',
        properties: {
          description: description,
          displayName: name,
          endpoint: endpoint,
          iconUrl: iconUrl,
          luisAppIds: [nlpAppId],
          luisKey: nlpKey,
          msaAppId: appId,
          msaAppPassword: appPassword,
          enabledChannels: ['webchat'], // , "skype", "facebook"],
          configuredChannels: ['webchat'] // , "skype", "facebook"]
        }
      };

      const httpClient = new ServiceClient();
      let query = `subscriptions/${subscriptionId}/resourceGroups/${group}/providers/${
        this.provider
      }/botServices/${botId}?api-version=${AzureDeployerService.apiVersion}`;
      let url = UrlJoin(baseUrl, query);
      let req = this.createRequestObject(
        url,
        accessToken,
        'PUT',
        JSON.stringify(parameters)
      );
      const res = await httpClient.sendRequest(req);
      if (!(res.bodyAsJson as any).id) {
        reject(res.bodyAsText);
        return;
      }

      setTimeout(async () => {
        try {
          query = `subscriptions/${subscriptionId}/resourceGroups/${group}/providers/Microsoft.BotService/botServices/${botId}/channels/WebChatChannel/listChannelWithKeys?api-version=${
            AzureDeployerService.apiVersion
          }`;
          url = UrlJoin(baseUrl, query);
          req = this.createRequestObject(
            url,
            accessToken,
            'GET',
            JSON.stringify(parameters)
          );
          const resChannel = await httpClient.sendRequest(req);
          const key = (resChannel.bodyAsJson as any).properties.properties
            .sites[0].key;
          instance.webchatKey = key;
          resolve(instance);
        } catch (error) {
          reject(error);
        }
      },         20000);
    });
  }

  private createRequestObject(
    url: string,
    accessToken: string,
    verb: HttpMethods,
    body: string
  ) {
    const req = new WebResource();
    req.method = verb;
    req.url = url;
    req.headers = {};
    req.headers['Content-Type'] = 'application/json';
    req.headers['accept-language'] = '*';
    req.headers.Authorization = 'Bearer ' + accessToken;
    req.body = body;
    return req;
  }

  private async createLUISApp(
    name: string,
    description: string,
    location: string,
    culture: string,
    authoringKey: string
  ) {
    const parameters = {
      name: name,
      description: description,
      culture: culture
    };

    const body = JSON.stringify(parameters);
    const apps = await this.makeNlpRequest(
      location,
      authoringKey,
      null,
      'GET',
      'apps'
    );
    const app = (apps.bodyAsJson as any).filter(x => x.name == name)[0];
    let id: string;
    if (!app) {
      const res = await this.makeNlpRequest(
        location,
        authoringKey,
        body,
        'POST',
        'apps'
      );
      id = res.bodyAsText;
    } else {
      id = app.id;
    }

    return id;
  }

  private async makeNlpRequest(
    location: string,
    authoringKey: string,
    body: string,
    method: HttpMethods,
    resource: string
  ) {
    const req = new WebResource();
    req.method = method;
    req.url = `https://${location}.api.cognitive.microsoft.com/luis/api/v2.0/${resource}`;
    req.headers = {};
    req.headers['Content-Type'] = 'application/json';
    req.headers['accept-language'] = '*';
    req.headers['Ocp-Apim-Subscription-Key'] = authoringKey;
    req.body = body;
    const httpClient = new ServiceClient();
    const res = await httpClient.sendRequest(req);
    return res;
  }

  private async createSearch(group, name, location) {
    const params = {
      sku: { name: 'free' },
      location: location
    };

    return this.searchClient.services.createOrUpdate(group, name, params);
  }

  private async createStorage(group, serverName, name, location) {
    const params = {
      sku: { name: 'Free' },
      createMode: 'Default',
      location: location
    };

    return this.storageClient.databases.createOrUpdate(
      group,
      serverName,
      name,
      params
    );
  }

  private async createCognitiveServices(
    group,
    name,
    location,
    kind
  ): Promise<CognitiveServicesAccount> {
    const params = {
      sku: { name: 'F0' },
      createMode: 'Default',
      location: location,
      kind: kind,
      properties: {}
    };

    return await this.cognitiveClient.accounts.create(group, name, params);
  }

  private async createSpeech(
    group,
    name,
    location
  ): Promise<CognitiveServicesAccount> {
    return await this.createCognitiveServices(
      group,
      name,
      location,
      'SpeechServices'
    );
  }

  private async createNLP(
    group,
    name,
    location
  ): Promise<CognitiveServicesAccount> {
    return await this.createCognitiveServices(group, name, location, 'LUIS');
  }

  private async createSpellChecker(
    group,
    name,
    location
  ): Promise<CognitiveServicesAccount> {
    return await this.createCognitiveServices(
      group,
      name,
      'global',
      'Bing.SpellCheck.v7'
    );
  }

  private async createTextAnalytics(
    group,
    name,
    location
  ): Promise<CognitiveServicesAccount> {
    return await this.createCognitiveServices(
      group,
      name,
      location,
      'TextAnalytics'
    );
  }

  private async createDeployGroup(name, location) {
    const params = { location: location };
    return this.resourceClient.resourceGroups.createOrUpdate(name, params);
  }

  private async createHostingPlan(
    group,
    name,
    location
  ): Promise<AppServicePlan> {
    const params = {
      serverFarmWithRichSkuName: name,
      location: location,
      sku: {
        name: 'F1',
        capacity: 1,
        tier: 'Free'
      }
    };

    return this.webSiteClient.appServicePlans.createOrUpdate(
      group,
      name,
      params
    );
  }

  private async createServer(farmId, group, name, location) {
    const parameters = {
      location: location,
      serverFarmId: farmId
    };
    return this.webSiteClient.webApps.createOrUpdate(group, name, parameters);
  }

  private async updateWebisteConfig(group, serverFarmId, name, location) {
    const siteConfig = {
      location: location,
      serverFarmId: serverFarmId,
      numberOfWorkers: 1,
      phpVersion: '5.5'
    };

    // TODO: Copy .env to app settings.

    return this.webSiteClient.webApps.createOrUpdateConfiguration(
      group,
      name,
      siteConfig
    );
  }
}
