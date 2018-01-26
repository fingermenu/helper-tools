// @flow

import BluebirdPromise from 'bluebird';
import Immutable, { List, Map, OrderedSet } from 'immutable';
import commandLineArgs from 'command-line-args';
import fs from 'fs';
import csvParser from 'csv-parse';
import { ImmutableEx } from '@microbusiness/common-javascript';
import { MenuService } from '@fingermenu/parse-server-common';
import Common from './Common';

const optionDefinitions = [
  { name: 'csvFilePath', type: String },
  { name: 'delimiter', type: String },
  { name: 'rowDelimiter', type: String },
  { name: 'applicationId', type: String },
  { name: 'javaScriptKey', type: String },
  { name: 'masterKey', type: String },
  { name: 'parseServerUrl', type: String },
  { name: 'username', type: String },
  { name: 'password', type: String },
];
const options = commandLineArgs(optionDefinitions);

const start = async () => {
  try {
    Common.initializeParse(options);

    const menuService = new MenuService();

    const parser = csvParser(
      { delimiter: options.delimiter ? options.delimiter : ',', trim: true, rowDelimiter: options.rowDelimiter ? options.rowDelimiter : '\r\n' },
      async (err, data) => {
        if (err) {
          console.log(err);

          return;
        }

        const splittedRows = ImmutableEx.splitIntoChunks(Immutable.fromJS(data).skip(1), 10); // Skipping the first item as it is the CSV header
        const columns = OrderedSet.of(
          'username',
          'en_NZ_name',
          'zh_name',
          'jp_name',
          'en_NZ_description',
          'zh_description',
          'jp_description',
          'menuPageUrl',
          'imageUrl',
          'tags',
        );

        await BluebirdPromise.each(splittedRows.toArray(), rowChunck =>
          Promise.all(rowChunck.map(async (rawRow) => {
            const values = Common.extractColumnsValuesFromRow(columns, Immutable.fromJS(rawRow));
            const user = await Common.getUser(values.get('username'));
            const menus = await Common.loadAllMenus(user, { name: values.get('en_NZ_name') });
            const tags = await Common.loadAllTags(user);
            const tagsToFind = Immutable.fromJS(values.get('tags').split('|'))
              .map(_ => _.trim())
              .filterNot(_ => _.length === 0);
            const info = Map({
              ownedByUser: user,
              maintainedByUsers: List.of(user),
              name: Map({ en_NZ: values.get('en_NZ_name'), zh: values.get('zh_name'), jp: values.get('jp_name') }),
              description: Map({ en_NZ: values.get('en_NZ_description'), zh: values.get('zh_description'), jp: values.get('jp_description') }),
              menuPageUrl: values.get('menuPageUrl'),
              imageUrl: values.get('imageUrl'),
              tagIds: tags.filter(tag => tagsToFind.find(_ => _.localeCompare(tag.getIn(['name', 'en_NZ'])) === 0)).map(tag => tag.get('id')),
            });

            if (menus.isEmpty()) {
              await menuService.create(info, null, global.parseServerSessionToken);
            } else if (menus.count() === 1) {
              await menuService.update(menus.first().merge(info), global.parseServerSessionToken);
            } else {
              console.error(`Multiple menus found with username ${values.get('username')} and menu name: ${values.get('en_NZ_name')}`);
            }
          })));
      },
    );

    fs.createReadStream(options.csvFilePath).pipe(parser);
  } catch (ex) {
    console.error(ex);
  }
};

start();
