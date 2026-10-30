// SPDX-License-Identifier: Apache-2.0
/** Service-owned capability. Never expose it through application exports or DTOs. */
export const automaticTimelineEdit: unique symbol = Symbol(
  "openfilm.automaticTimelineEdit",
);
