// @flow

import { ImmutableEx } from '@microbusiness/common-javascript';
import { ParseWrapperService } from '@microbusiness/parse-server-common';
import { SizeService } from '@fingermenu/parse-server-common';
import BluebirdPromise from 'bluebird';
import Immutable, { List, Map, OrderedSet } from 'immutable';
import commandLineArgs from 'command-line-args';
import fs from 'fs';
import csvParser from 'csv-parse';
import Common from './Common';

const optionDefinitions = [
  { name: 'csvFilePath', type: String },
  { name: 'delimiter', type: String },
  { name: 'rowDelimiter', type: String },
  { name: 'applicationId', type: String },
  { name: 'javaScriptKey', type: String },
  { name: 'masterKey', type: String },
  { name: 'parseServerUrl', type: String },
];
const options = commandLineArgs(optionDefinitions);

const start = async () => {
  try {
    await Common.initializeParse(options);

    const sizeService = new SizeService();

    const parser = csvParser(
      { delimiter: options.delimiter ? options.delimiter : ',', trim: true, rowDelimiter: options.rowDelimiter ? options.rowDelimiter : '\r\n' },
      async (err, data) => {
        if (err) {
          console.log(err);

          return;
        }

        const dataWithoutHeader = Immutable.fromJS(data).skip(1);
        const splittedRows = ImmutableEx.splitIntoChunks(dataWithoutHeader, 10); // Skipping the first item as it is the CSV header
        const columns = OrderedSet.of('username', 'tagName');
        const oneOffData = await Common.loadOneOffData(dataWithoutHeader, columns);

        await BluebirdPromise.each(splittedRows.toArray(), rowChunck =>
          Promise.all(
            rowChunck.map(async rawRow => {
              if (!rawRow || rawRow.isEmpty() || rawRow.every(row => row.trim().length === 0)) {
                return;
              }

              const values = Common.extractColumnsValuesFromRow(columns, Immutable.fromJS(rawRow));
              const user = oneOffData.getIn([values.get('username'), 'user']);
              const tag = await Common.loadAllTags(user, { name: values.get('tagName') });

              if (tag.isEmpty()) {
                console.error('No tag found with name: ' + values.get('tagName'));

                return;
              }

              if (tag.count() > 1) {
                console.error('Multiple tags found with name: ' + values.get('tagName'));

                return;
              }

              const sizes = await Common.loadAllSizes(user, { tagId: tag.first().get('id') });
              const info = Map({
                ownedByUser: user,
                maintainedByUsers: List.of(user),
                tagId: tag.first().get('id'),
              });

              if (sizes.isEmpty()) {
                const acl = ParseWrapperService.createACL(user);

                acl.setPublicReadAccess(true);
                acl.setRoleReadAccess('administrators', true);
                acl.setRoleWriteAccess('administrators', true);

                await sizeService.create(info, acl, null, true);
              } else if (sizes.count() > 1) {
                console.error(`Multiple dietary options time found with username ${values.get('username')} and tag name: ${values.get('tagName')}`);
              }
            }),
          ),
        );
      },
    );

    fs.createReadStream(options.csvFilePath).pipe(parser);
  } catch (ex) {
    console.error(ex);
  }
};

start();
