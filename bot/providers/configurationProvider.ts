// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TableService, createTableService } from "azure-storage";

export class ConfigurationDataProvider {
  private readonly configurationTableName: string = "ConfigurationInfo";
  private readonly configurationPartitionKey: string = "ConfigurationInfo";

  private readonly connectionString: string;
  private tableService: TableService;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  public async getSavedEntityDetailAsync(entityType: string): Promise<string> {
    await this.ensureInitialize();
    return new Promise((resolve, reject) => {
      this.tableService.retrieveEntity(
        this.configurationTableName,
        this.configurationPartitionKey,
        entityType,
        (error, result: any) => {
          if (!error) {
            resolve(result?.Data._ ?? "");
          }
          reject(error);
        }
      );
    });
  }

  public async ensureInitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.tableService) {
        resolve();
      } else {
        this.tableService = createTableService(this.connectionString);
        this.tableService.createTableIfNotExists(this.configurationTableName, (error) => {
          if (!error) {
            resolve();
          }
          reject(error);
        });
      }
    });
  }
}
