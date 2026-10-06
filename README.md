Cockpit plugin that provides an interface to the RHEL Command Line Assistant (CLA)

cockpit-cla-1.0.0.tar.gz
tarball of the files that can be used to build your own rpm

cockpit-cla.spec
spec file to build your own rpm

cockpit-cla-1.0.0
directory containing all the files in the above .tar.gz file

cockpit-cla-1.0.0-2.noarch.rpm
rpm that can be installed without the need to build it yourself with:  
```rpm -Uvh https://github.com/chipatredhat/cockpit-cla/raw/refs/heads/main/cockpit-cla-1.0.0-2.noarch.rpm```

the .spec file goes in your rpmbuild/SPECS directory, the .tar.gz file goes in your rpmbuild/SOURCES directory, and you build your rpm with rpmbuild -bb <path/to>/cockpit-cla.spec

props to Choirboy (IYKYK) for suggesting I put this into a cockpit plugin.
