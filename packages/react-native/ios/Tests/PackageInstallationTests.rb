require 'minitest/autorun'
require 'xcodeproj'
require 'tmpdir'
require_relative '../tileflow_post_install'

class PackageInstallationTests < Minitest::Test
  def test_embeds_the_resolved_renderer_once_only_for_consuming_apps
    Dir.mktmpdir('tileflow-pods-') do |root|
      project = Xcodeproj::Project.new(File.join(root, 'Example.xcodeproj'))
      app = project.new_target(:application, 'Example', :ios, '16.0')
      unrelated = project.new_target(:application, 'Other', :ios, '16.0')
      pod = Struct.new(:root_spec).new(Struct.new(:name).new('TileflowReactNative'))
      aggregate = Struct.new(:user_targets, :pod_targets).new([app], [pod])
      installer = Struct.new(:aggregate_targets).new([aggregate])

      2.times { tileflow_embed_renderer(installer) }

      copies = app.copy_files_build_phases.flat_map(&:files).select do |file|
        file.file_ref.path == 'MapLibre.framework'
      end
      assert_equal 1, copies.size
      assert_equal 'BUILT_PRODUCTS_DIR', copies.first.file_ref.source_tree
      assert_equal ['CodeSignOnCopy', 'RemoveHeadersOnCopy'], copies.first.settings['ATTRIBUTES']
      assert_equal '10', app.copy_files_build_phases.find { |phase| phase.files.include?(copies.first) }.dst_subfolder_spec
      assert_empty unrelated.copy_files_build_phases
      assert_empty app.package_product_dependencies
    end
  end
end
