import posthog from "posthog-js";

posthog.init(
    "phc_DQ6d0Z6KYfcHxqTJzR6xtgSLNrCtVdnG3LM8yuUzgiS",
    {
        api_host: "https://us.i.posthog.com",

        person_profiles: "identified_only",

        capture_pageview: true,
        capture_pageleave: true,
    }
);

export default posthog;