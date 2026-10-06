# Copyright © 2026 Chip Shabazian - chip@redhat.com
Name:           cockpit-cla
Version:        1.0.0
Release:        2
Summary:        Cockpit interface for the RHEL Command Line Assistant

License:        GPL3
URL:            https://github.com/chipatredhat/cockpit-cla
Source0:        %{name}-%{version}.tar.gz

BuildArch:      noarch

# Cockpit runs the plugin's commands through the bridge on the target host.
Requires:       cockpit-bridge
Requires:       cockpit-ws
# Provides the `c` command the plugin shells out to (/bin/c).
Recommends:     command-line-assistant

%description
A Cockpit plugin that lets you query the RHEL Command Line Assistant from
the Cockpit web console. Queries are passed to the system's `c` command with
the -p flag (plain text, no ANSI colors), and the output is displayed in the
browser along with a per-user, persistent session history.

%prep
%autosetup

%build
# Nothing to build: the plugin is static HTML, CSS and JavaScript.

%install
install -d -m 0755 %{buildroot}%{_datadir}/cockpit/cla
install -p -m 0644 manifest.json index.html cla.js cla.css \
    %{buildroot}%{_datadir}/cockpit/cla/

%files
%dir %{_datadir}/cockpit/cla
%{_datadir}/cockpit/cla/manifest.json
%{_datadir}/cockpit/cla/index.html
%{_datadir}/cockpit/cla/cla.js
%{_datadir}/cockpit/cla/cla.css

%changelog
* Tue Oct 06 2026 Chip <chip@redhat.com> - 1.0.0-2
- Changed submit button from 'Run Command' to 'Run Query'
* Tue Oct 06 2026 Chip <chip@redhat.com> - 1.0.0-1
- Initial package of the Cockpit Command Line Assistant plugin
