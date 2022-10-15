const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require("copy-webpack-plugin");
const path = require('path');
const fs = require('fs');
const packageJson = require('./package')

module.exports = {
  entry: './src/index',
  output: {
    path: path.resolve(__dirname, 'public')
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public_src/index.html',
    }),
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "public_src/style.css"),
          to: path.resolve(__dirname, "public/style.css"),
        },
      ],
    }),
  ],
};
